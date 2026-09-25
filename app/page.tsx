"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Clip={id:string;name:string;url:string;duration:number};
type Highlight={clip:Clip;start:number;dur:number;score:number};
type TransitionKind="cut"|"dissolve"|"zoom"|"flash";
type EditorClip={id:string;source:Clip;start:number;end:number;speed:number;zoom:number;x:number;y:number;filter:string;volume:number;muted:boolean};

const styles=["Cinematic","Action","Funny","Emotional","Party","Travel","Fast Cut","Relaxed"];
const lengths=[1,3,5,10];

function fmt(s:number){if(!Number.isFinite(s))return "0:00";const m=Math.floor(s/60);const sec=Math.floor(s%60).toString().padStart(2,"0");return m+":"+sec}

function transitionFor(style:string, score:number):TransitionKind{
  if(style==="Cinematic"||style==="Emotional"||style==="Travel")return "dissolve";
  if(style==="Action"||style==="Fast Cut")return score>.22?"zoom":"cut";
  if(style==="Party"||style==="Funny")return score>.28?"flash":"zoom";
  return "dissolve";
}

async function scoreClip(clip:Clip, style:string):Promise<Highlight[]>{
  const v=document.createElement("video"); v.src=clip.url; v.muted=true; v.playsInline=true; v.preload="auto";
  await new Promise<void>((res,rej)=>{v.onloadeddata=()=>res();v.onerror=()=>rej(new Error("Video konnte nicht analysiert werden."))});
  const canvas=document.createElement("canvas"); canvas.width=48; canvas.height=27;
  const ctx=canvas.getContext("2d",{willReadFrequently:true}); if(!ctx)throw new Error("Analyse nicht verfügbar.");
  const count=Math.max(3,Math.min(12,Math.ceil(clip.duration/3)));
  const frames:{t:number;energy:number;change:number}[]=[]; let prev:Uint8ClampedArray|null=null;
  for(let i=0;i<count;i++){
    const t=(clip.duration<1?0:(i/(count-1))*Math.max(0,clip.duration-.25));
    v.currentTime=t; await new Promise<void>((res,rej)=>{const timer=window.setTimeout(()=>rej(new Error("Frame konnte nicht gelesen werden.")),5000);v.onseeked=()=>{clearTimeout(timer);res()};});
    ctx.drawImage(v,0,0,48,27); const data=ctx.getImageData(0,0,48,27).data;
    let brightness=0,diff=0;
    for(let p=0;p<data.length;p+=4){brightness+=(data[p]+data[p+1]+data[p+2])/3;if(prev)diff+=Math.abs(data[p]-prev[p])+Math.abs(data[p+1]-prev[p+1])+Math.abs(data[p+2]-prev[p+2])}
    const energy=brightness/(48*27*255); const change=prev?diff/(48*27*3*255):0;
    frames.push({t,energy,change}); prev=data;
  }
  v.remove();
  const highlights:Highlight[]=[];
  const segmentWindow=Math.min(4.5,Math.max(2,clip.duration*.22));
  for(let i=0;i<frames.length;i++){
    const f=frames[i]; const motion=f.change; const bright=1-Math.abs(f.energy-.58); let styleBonus=0;
    if(style==="Relaxed"||style==="Emotional")styleBonus=(1-motion)*.22;
    if(style==="Action"||style==="Fast Cut")styleBonus=motion*.3;
    if(style==="Funny"||style==="Party")styleBonus=Math.min(1,motion*1.5)*.18;
    const score=motion*.62+bright*.2+styleBonus;
    highlights.push({clip,start:Math.max(0,Math.min(clip.duration-segmentWindow,f.t-segmentWindow/2)),dur:segmentWindow,score});
  }
  return highlights.sort((a,b)=>b.score-a.score).slice(0,Math.min(3,highlights.length));
}

async function wait(ms:number){await new Promise(r=>setTimeout(r,ms))}

async function analyzeWithGemini(clip:Clip, style:string, attempt=1):Promise<Highlight[]>{
  const v=document.createElement("video");
  v.src=clip.url; v.muted=true; v.playsInline=true; v.preload="metadata";
  try{
    await new Promise<void>((res,rej)=>{const timer=window.setTimeout(()=>rej(new Error("Videoanalyse Timeout")),12000);v.onloadeddata=()=>{clearTimeout(timer);res()};v.onerror=()=>{clearTimeout(timer);rej(new Error("Video konnte für die KI-Analyse nicht geladen werden."))}});
    const canvas=document.createElement("canvas"); canvas.width=240; canvas.height=135;
    const ctx=canvas.getContext("2d"); if(!ctx)throw new Error("KI-Bildanalyse nicht verfügbar.");
    const count=Math.max(5,Math.min(8,Math.ceil(clip.duration/3))); const frames:{time:number;data:string}[]=[];
    for(let i=0;i<count;i++){
      const t=clip.duration<1?0:(i/(count-1))*Math.max(0,clip.duration-.2); v.currentTime=t;
      await new Promise<void>((res,rej)=>{const timer=window.setTimeout(()=>rej(new Error("Frame Timeout")),5000);v.onseeked=()=>{clearTimeout(timer);res()}});
      ctx.drawImage(v,0,0,canvas.width,canvas.height); frames.push({time:t,data:canvas.toDataURL("image/jpeg",.5).split(",")[1]});
    }
    const response=await fetch("/api/ai-analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({style,duration:clip.duration,frames})});
    const body=await response.json().catch(()=>({})); if(!response.ok)throw new Error(body?.error||"Gemini API Fehler.");
    const highlights=Array.isArray(body.highlights)?body.highlights:[]; return highlights.map((h:{start?:number;duration?:number;score?:number})=>{const dur=Math.min(4.5,Math.max(2,Number(h.duration)||3));const maxStart=Math.max(0,clip.duration-dur);return {clip,start:Math.max(0,Math.min(maxStart,Number(h.start)||0)),dur,score:Math.max(0,Math.min(1,Number(h.score)||0))}});
  }catch(err){if(attempt<2){await wait(700);return analyzeWithGemini(clip,style,attempt+1)}throw err}
  finally{v.pause();v.removeAttribute("src");v.load();v.remove()}
}

export default function Home(){
 const [clips,setClips]=useState<Clip[]>([]); const [length,setLength]=useState(3); const [style,setStyle]=useState("Cinematic");
 const [ratio,setRatio]=useState("9:16"); const [busy,setBusy]=useState(false); const [progress,setProgress]=useState(0); const [result,setResult]=useState<string|null>(null); const [analysis,setAnalysis]=useState("");
 const [title,setTitle]=useState("BEST MOMENTS"); const [subtitle,setSubtitle]=useState("Videoeditor47 · 2026");
 const [filter,setFilter]=useState("Auto"); const [aiEnabled,setAiEnabled]=useState(true); const [aiStatus,setAiStatus]=useState("");
 const [editorOpen,setEditorOpen]=useState(false); const [editorClips,setEditorClips]=useState<EditorClip[]>([]); const [editorIndex,setEditorIndex]=useState(0); const [editorPlaying,setEditorPlaying]=useState(false); const [editorTime,setEditorTime]=useState(0); const editorVideoRef=useRef<HTMLVideoElement>(null);
 function openEditor(){if(!clips.length)return;setEditorClips(clips.map((c,i)=>({id:c.id+"-edit-"+i,source:c,start:0,end:c.duration,speed:1,zoom:1,x:0,y:0,filter:"Auto",volume:1,muted:false})));setEditorIndex(0);setEditorTime(0);setEditorOpen(true);setEditorPlaying(false)}
 const currentEditor=editorClips[editorIndex];
 function updateEditor(p:Partial<EditorClip>){setEditorClips(a=>a.map((x,i)=>i===editorIndex?{...x,...p}:x))}
 function seekEditor(t:number){if(!currentEditor)return;const n=Math.max(0,Math.min(currentEditor.end-currentEditor.start,t));setEditorTime(n);if(editorVideoRef.current)editorVideoRef.current.currentTime=currentEditor.start+n*currentEditor.speed}
 function toggleEditorPlay(){const v=editorVideoRef.current;if(!v)return;if(editorPlaying){v.pause();setEditorPlaying(false)}else{v.play().then(()=>setEditorPlaying(true)).catch(()=>{})}}
 function splitEditor(){if(!currentEditor)return;const cut=currentEditor.start+editorTime*currentEditor.speed;if(cut<=currentEditor.start+.1||cut>=currentEditor.end-.1)return;const a={...currentEditor,end:cut,id:currentEditor.id+"a"};const b={...currentEditor,start:cut,id:currentEditor.id+"b"};setEditorClips(x=>[...x.slice(0,editorIndex),a,b,...x.slice(editorIndex+1)]);setEditorIndex(editorIndex+1);setEditorTime(0)}
 function deleteEditor(){if(!currentEditor)return;setEditorClips(x=>x.filter((_,i)=>i!==editorIndex));setEditorIndex(i=>Math.max(0,Math.min(i,editorClips.length-2)));setEditorTime(0)}
 function moveEditor(dir:number){const n=editorIndex+dir;if(n<0||n>=editorClips.length)return;setEditorClips(x=>{const a=[...x];[a[editorIndex],a[n]]=[a[n],a[editorIndex]];return a});setEditorIndex(n);setEditorTime(0)}
 function resetEditor(){if(!currentEditor)return;updateEditor({start:0,end:currentEditor.source.duration,speed:1,zoom:1,x:0,y:0,filter:"Auto",volume:1,muted:false});setEditorTime(0)}
 function editorDuration(){return editorClips.reduce((s,c)=>s+(c.end-c.start)/c.speed,0)}
 async function exportEdited(){if(!editorClips.length||busy)return;setBusy(true);setProgress(0);try{const vertical=ratio==="9:16",wide=ratio==="16:9";const W=vertical?720:wide?1280:1080,H=vertical?1280:wide?720:1080;const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Canvas nicht verfügbar.");const vs=canvas.captureStream(30);const AC=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;const ac=AC?new AC():null;const dest=ac?.createMediaStreamDestination()??null;const stream=new MediaStream([...vs.getVideoTracks(),...(dest?.stream.getAudioTracks()??[])]);let rec:MediaRecorder;try{rec=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp9,opus"})}catch{rec=new MediaRecorder(stream,{mimeType:"video/webm"})}const chunks:Blob[]=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};const done=new Promise<void>(r=>rec.onstop=()=>r());rec.start(250);let totalDone=0;for(const ec of editorClips){const v=document.createElement("video");v.src=ec.source.url;v.playsInline=true;v.muted=false;v.volume=ec.muted?0:ec.volume;const src=ac&&dest?ac.createMediaElementSource(v):null;if(src&&dest)src.connect(dest);await new Promise<void>((r,j)=>{v.onloadeddata=()=>r();v.onerror=()=>j(new Error("Video konnte nicht geladen werden."))});v.currentTime=ec.start;v.playbackRate=ec.speed;await v.play();const dur=ec.end-ec.start;const begin=performance.now();while(performance.now()-begin<dur/ec.speed*1000){const vw=v.videoWidth||W,vh=v.videoHeight||H,s=Math.max(W/vw,H/vh)*ec.zoom,dw=vw*s,dh=vh*s;ctx.fillStyle="#000";ctx.fillRect(0,0,W,H);ctx.filter=ec.filter==="Noir"?"grayscale(1) contrast(1.2)":ec.filter==="Warm"?"sepia(.18) saturate(1.15)":ec.filter==="Cool"?"saturate(.9) hue-rotate(10deg)":ec.filter==="Vivid"?"saturate(1.35) contrast(1.08)":"none";ctx.drawImage(v,(W-dw)/2+ec.x,(H-dh)/2+ec.y,dw,dh);ctx.filter="none";await new Promise(r=>setTimeout(r,16))}v.pause();src?.disconnect();v.remove();totalDone+=dur/ec.speed;setProgress(Math.min(99,Math.round(totalDone/editorDuration()*100)))}rec.stop();await done;stream.getTracks().forEach(t=>t.stop());if(ac)await ac.close();setResult(URL.createObjectURL(new Blob(chunks,{type:"video/webm"})));setEditorOpen(false);setAnalysis("Bearbeitete Version ist bereit.");setProgress(100)}catch(err){alert(err instanceof Error?err.message:"Export fehlgeschlagen.")}finally{setBusy(false)}}
 const fileRef=useRef<HTMLInputElement>(null); const total=useMemo(()=>clips.reduce((a,c)=>a+c.duration,0),[clips]);
 useEffect(()=>()=>clips.forEach(c=>URL.revokeObjectURL(c.url)),[]);
 function addFiles(e:ChangeEvent<HTMLInputElement>){const fs=Array.from(e.target.files||[]);const next:Clip[]=[];let done=0;if(!fs.length)return;fs.forEach((f,i)=>{const url=URL.createObjectURL(f);const v=document.createElement("video");v.preload="metadata";v.onloadedmetadata=()=>{next.push({id:f.name+"-"+i,name:f.name,url,duration:v.duration||5});done++;if(done===fs.length)setClips(p=>[...p,...next])};v.onerror=()=>{done++;if(done===fs.length)setClips(p=>[...p,...next])};v.src=url});e.target.value=""}
 function remove(id:string){setClips(p=>p.filter(c=>c.id!==id))}
 function filterStyle(ctx:CanvasRenderingContext2D,W:number,H:number){
   ctx.save();
   if(filter==="Warm"){ctx.fillStyle="rgba(255,150,55,.10)";ctx.fillRect(0,0,W,H)}
   if(filter==="Cool"){ctx.fillStyle="rgba(70,150,255,.10)";ctx.fillRect(0,0,W,H)}
   if(filter==="Noir"){ctx.globalCompositeOperation="saturation";ctx.fillStyle="#000";ctx.fillRect(0,0,W,H);ctx.globalCompositeOperation="source-over";ctx.fillStyle="rgba(0,0,0,.12)";ctx.fillRect(0,0,W,H)}
   if(filter==="Vivid"){ctx.fillStyle="rgba(255,255,255,.04)";ctx.fillRect(0,0,W,H)}
   const g=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.2,W/2,H/2,Math.max(W,H)*.72);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,"rgba(0,0,0,.24)");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
   ctx.restore();
 }
 async function render(){
  if(!clips.length||busy)return; setBusy(true);setResult(null);setProgress(0);
  try{
   const target=Math.min(length*60,total); if(target<=0)throw new Error("Keine abspielbaren Videos.");
   setAnalysis(aiEnabled?"1/4 · Gemini analysiert die wichtigsten Momente …":"1/4 · Szenen werden lokal analysiert …"); setAiStatus("");
   const all:Highlight[]=[]; const batchSize=Math.min(3,Math.max(1,clips.length)); let analyzed=0;
   for(let batchStart=0;batchStart<clips.length;batchStart+=batchSize){
     const batch=clips.slice(batchStart,batchStart+batchSize);
     const results=await Promise.all(batch.map(async clip=>{try{if(aiEnabled){const found=await analyzeWithGemini(clip,style);return {found,mode:"Gemini"}}return {found:await scoreClip(clip,style),mode:"Lokal"} }catch{try{return {found:await scoreClip(clip,style),mode:"Fallback"}}catch{return {found:[] as Highlight[],mode:"Übersprungen"}}}}));
     results.forEach((r)=>{all.push(...r.found);analyzed++;const mode=r.mode==="Gemini"?"🤖 Gemini":r.mode==="Fallback"?"🛟 lokaler Fallback":r.mode==="Lokal"?"📱 lokal":"⚠️ übersprungen";setAiStatus(mode+" · Video "+analyzed+" von "+clips.length);setProgress(Math.round((analyzed/clips.length)*25))});
     if(batchStart+batchSize<clips.length)await wait(150);
   }
   if(!all.length)throw new Error("Es konnten keine Highlights gefunden werden.");
   all.sort((a,b)=>b.score-a.score); const chosen:Highlight[]=[]; let remaining=target;
   for(const h of all){if(remaining<=0)break;const overlap=chosen.some(x=>x.clip.id===h.clip.id&&Math.abs(x.start-h.start)<h.dur*.8);if(overlap)continue;const dur=Math.min(h.dur,remaining);chosen.push({...h,dur});remaining-=dur}
   if(remaining>0){for(const c of clips){if(remaining<=0)break;const dur=Math.min(remaining,Math.min(3,c.duration));chosen.push({clip:c,start:Math.max(0,(c.duration-dur)/2),dur,score:0});remaining-=dur}}
   if(!chosen.length)throw new Error("Keine Highlights gefunden.");
   setAnalysis("2/4 · Schnitt, Reihenfolge und Übergänge werden geplant …");setProgress(35);
   const vertical=ratio==="9:16",wide=ratio==="16:9"; const W=vertical?720:wide?1280:1080,H=vertical?1280:wide?720:1080;
   const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Canvas nicht verfügbar.");
   const videoStream=canvas.captureStream(30);
   // Capture the original video audio as well as the rendered canvas.
   const AudioContextClass=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
   const audioContext=AudioContextClass?new AudioContextClass():null;
   const audioDestination=audioContext?.createMediaStreamDestination()??null;
   if(audioContext?.state==="suspended")await audioContext.resume();
   const stream=new MediaStream([...videoStream.getVideoTracks(),...(audioDestination?.stream.getAudioTracks()??[])]);
   let recorder:MediaRecorder;const chunks:Blob[]=[];
   try{recorder=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp9,opus"})}catch{try{recorder=new MediaRecorder(stream,{mimeType:"video/webm"})}catch{recorder=new MediaRecorder(stream)}}
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   const finished=new Promise<void>((resolve,reject)=>{recorder.onstop=()=>resolve();recorder.onerror=()=>reject(new Error("Aufnahme fehlgeschlagen"))});
   recorder.start(250);let doneTime=0;const lastFrame=document.createElement("canvas");lastFrame.width=W;lastFrame.height=H;const lastCtx=lastFrame.getContext("2d");let previous:Highlight|null=null;
   setAnalysis("3/4 · Profi-Look wird gerendert …");
   for(let si=0;si<chosen.length;si++){
    const seg=chosen[si],v=document.createElement("video");v.src=seg.clip.url;v.muted=false;v.playsInline=true;v.preload="auto";
    const audioSource=audioContext&&audioDestination?audioContext.createMediaElementSource(v):null;
    if(audioSource&&audioDestination)audioSource.connect(audioDestination);
    await new Promise<void>((res,rej)=>{v.onloadeddata=()=>res();v.onerror=()=>rej(new Error("Video konnte nicht geladen werden."))});
    await v.play();v.currentTime=seg.start;const start=performance.now();const transition=previous?transitionFor(style,seg.score):"cut";const transMs=transition==="cut"?0:Math.min(650,seg.dur*280);
    while(performance.now()-start<seg.dur*1000){
      const elapsed=performance.now()-start;
      if(v.readyState>=2){const vw=v.videoWidth||W,vh=v.videoHeight||H,scale=Math.max(W/vw,H/vh),dw=vw*scale,dh=vh*scale;ctx.fillStyle="#000";ctx.fillRect(0,0,W,H);
       const p=transMs?Math.min(1,elapsed/transMs):1;if(previous&&lastCtx&&p<1){ctx.globalAlpha=1-p;ctx.drawImage(lastFrame,0,0,W,H);ctx.globalAlpha=1}
       ctx.save();if(transition==="zoom"&&previous&&p<1){const z=1.04-.04*p;ctx.translate(W/2,H/2);ctx.scale(z,z);ctx.translate(-W/2,-H/2)}
       ctx.globalAlpha=previous?Math.max(.02,p):1;ctx.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh);ctx.globalAlpha=1;ctx.restore();
       if(transition==="flash"&&previous&&p<1){ctx.fillStyle="rgba(255,255,255,"+((1-p)*.3)+")";ctx.fillRect(0,0,W,H)}
       filterStyle(ctx,W,H);
       const edgeFade=Math.min(1,Math.min(elapsed/240,(seg.dur*1000-elapsed)/240));ctx.fillStyle="rgba(0,0,0,"+(1-Math.max(0,edgeFade))*.25+")";ctx.fillRect(0,0,W,H);
       if(style==="Fast Cut"){ctx.fillStyle="#fff";ctx.font="700 22px Arial";ctx.fillText("VIDEOEDITOR47",24,H-30)}
      }
      doneTime+=16;setProgress(35+Math.min(60,Math.round(doneTime/(target*1000)*60)));await new Promise(r=>setTimeout(r,16));
    }
    if(lastCtx)lastCtx.drawImage(canvas,0,0);previous=seg;v.pause();audioSource?.disconnect();v.remove();
   }
   setAnalysis("4/4 · Titel und Outro werden eingebaut …");setProgress(96);
   const titleFrames=Math.round(30*1.8);
   for(let i=0;i<titleFrames;i++){ctx.fillStyle="#090b10";ctx.fillRect(0,0,W,H);const p=Math.min(1,i/12,(titleFrames-i)/12);ctx.globalAlpha=p;ctx.fillStyle="#fff";ctx.textAlign="center";ctx.font="700 "+Math.round(Math.min(W,H)*.075)+"px Arial";ctx.fillText(title||"BEST MOMENTS",W/2,H*.47);ctx.font="400 "+Math.round(Math.min(W,H)*.028)+"px Arial";ctx.fillText(subtitle||"Videoeditor47",W/2,H*.55);ctx.globalAlpha=1;ctx.textAlign="left";await new Promise(r=>setTimeout(r,33))}
   recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());videoStream.getTracks().forEach(t=>t.stop());if(audioContext)await audioContext.close();setAnalysis("Fertig! Dein automatischer Edit ist bereit.");setProgress(100);setResult(URL.createObjectURL(new Blob(chunks,{type:"video/webm"})));
  }catch(err){alert(err instanceof Error?err.message:"Recap fehlgeschlagen.");}finally{setBusy(false)}
 }
 return <main className="app">
  <div className="top"><div className="logo">Videoeditor47</div><div className="badge">KI-Style · Gemini + lokal</div></div>
  <section className="hero"><h1>Dein automatischer Video-Edit.<br/>Wie ein fertiger Recap.</h1><p>Videos rein – Videoeditor47 analysiert Szenen und erstellt automatisch Schnitt, Reihenfolge, Übergänge, Titel und Look. Die Videos bleiben lokal; für die KI werden nur ausgewählte Einzelbilder an Gemini gesendet. Der Originalton bleibt im fertigen Video erhalten.</p>
   <div className="drop"><strong>{clips.length?clips.length+" Videos ausgewählt":"Noch keine Videos"}</strong><span className="small">Mehrere Videos gleichzeitig auswählen</span><br/><label className="choose">＋ Videos auswählen<input ref={fileRef} className="hidden" type="file" accept="video/*" multiple onChange={addFiles}/></label></div>
  </section>
  {clips.length>0&&<section className="section"><h2>Deine Videos · {fmt(total)} gesamt</h2><div className="videos">{clips.map(c=><div className="videoCard" key={c.id}><button className="remove" onClick={()=>remove(c.id)}>×</button><video src={c.url} muted playsInline preload="metadata"/><div className="videoInfo">{c.name}</div></div>)}</div></section>}
  <section className="section"><h2>Recap-Länge</h2><div className="chips">{lengths.map(x=><button className={"chip "+(length===x?"active":"")} key={x} onClick={()=>setLength(x)}>{x} Min.</button>)}</div></section>
  <section className="section"><h2>Stil</h2><div className="chips">{styles.map(x=><button className={"chip "+(style===x?"active":"")} key={x} onClick={()=>setStyle(x)}>{x}</button>)}</div></section>
  <section className="section"><h2>KI-Analyse</h2><div className="aiBox"><div><strong>🤖 Gemini Highlights</strong><p className="small">Die KI bewertet ausgewählte Einzelbilder aus deinen Videos und sucht passende Momente für deinen gewählten Stil. Die Originalvideos werden nicht an Gemini geschickt.</p></div><button className={"chip "+(aiEnabled?"active":"")} onClick={()=>setAiEnabled(v=>!v)}>{aiEnabled?"KI aktiv":"Nur lokal"}</button></div></section>
  <section className="section"><h2>Automatischer Look</h2><div className="chips">{["Auto","Warm","Cool","Vivid","Noir"].map(x=><button className={"chip "+(filter===x?"active":"")} key={x} onClick={()=>setFilter(x)}>{x}</button>)}</div></section>
  <section className="section"><h2>Titel</h2><input className="textInput" value={title} onChange={e=>setTitle(e.target.value)} placeholder="BEST MOMENTS"/><input className="textInput" value={subtitle} onChange={e=>setSubtitle(e.target.value)} placeholder="Videoeditor47 · 2026"/></section>
  <section className="section"><h2>Format</h2><div className="chips">{["9:16","16:9","1:1"].map(x=><button className={"chip "+(ratio===x?"active":"")} key={x} onClick={()=>setRatio(x)}>{x}</button>)}</div></section>
  <section className="section"><h2>Automatisch bearbeiten</h2><p className="small">Gemini analysiert die Videos in kleinen Gruppen. Bei Fehlern wird automatisch lokal weiteranalysiert, damit einzelne Videos den gesamten Recap nicht stoppen.</p><button className="mainBtn" disabled={!clips.length||busy} onClick={render}>{busy?"✨ Dein Edit wird erstellt …":"✨ Automatischen CapCut-Style Edit erstellen"}</button>{busy&&<><p className="small">{analysis}</p>{aiStatus&&<p className="small">{aiStatus}</p>}<div className="progress"><i style={{width:progress+"%"}}/></div></>}</section>
  {result&&<section className="section result"><h2>Fertiger Edit 🎉</h2><video controls playsInline src={result}/><a className="download" href={result} download={"Videoeditor47-Edit.webm"}>⬇️ Fertiges Video speichern</a><button className="editBtn" onClick={openEditor}>✏️ Bearbeiten</button><p className="small">Öffnet einen richtigen Schnittbereich für deine einzelnen Clips.</p></section>}
  {editorOpen&&<section className="section editor"><div className="editorHead"><div><h2>🎬 Bearbeiten</h2><p className="small">Schneiden · Splitten · Filter · Zoom · Position · Tempo · Lautstärke</p></div><button className="chip" onClick={()=>setEditorOpen(false)}>Schließen</button></div>
   <div className="editorStage">{currentEditor&&<video ref={editorVideoRef} src={currentEditor.source.url} playsInline onTimeUpdate={e=>setEditorTime(Math.max(0,(e.currentTarget.currentTime-currentEditor.start)/currentEditor.speed))} style={{transform:"translate("+currentEditor.x+"px,"+currentEditor.y+"px) scale("+currentEditor.zoom+")",filter:currentEditor.filter==="Noir"?"grayscale(1)":currentEditor.filter==="Warm"?"sepia(.2) saturate(1.15)":currentEditor.filter==="Cool"?"hue-rotate(10deg) saturate(.9)":currentEditor.filter==="Vivid"?"saturate(1.4)":"none"}}/>}</div>
   {currentEditor&&<><div className="editorControls"><button className="chip" onClick={toggleEditorPlay}>{editorPlaying?"⏸ Pause":"▶️ Play"}</button><button className="chip" onClick={()=>seekEditor(editorTime-5)}>↶ 5s</button><button className="chip" onClick={()=>seekEditor(editorTime+5)}>5s ↷</button><button className="chip" onClick={()=>seekEditor(0)}>⏮ Anfang</button><button className="chip" onClick={splitEditor}>✂️ Split</button><button className="chip" onClick={deleteEditor}>🗑 Löschen</button><button className="chip" onClick={()=>moveEditor(-1)}>← Vorher</button><button className="chip" onClick={()=>moveEditor(1)}>Nachher →</button></div>
    <input className="editorRange" type="range" min="0" max={Math.max(.01,(currentEditor.end-currentEditor.start)/currentEditor.speed)} step=".01" value={Math.min(editorTime,(currentEditor.end-currentEditor.start)/currentEditor.speed)} onChange={e=>seekEditor(Number(e.target.value))}/>
    <div className="editorGrid"><label>Start (s)<input type="number" min="0" max={currentEditor.end-.1} step=".1" value={currentEditor.start} onChange={e=>updateEditor({start:Math.max(0,Math.min(Number(e.target.value),currentEditor.end-.1))})}/></label><label>Ende (s)<input type="number" min={currentEditor.start+.1} max={currentEditor.source.duration} step=".1" value={currentEditor.end} onChange={e=>updateEditor({end:Math.max(currentEditor.start+.1,Math.min(Number(e.target.value),currentEditor.source.duration))})}/></label><label>Tempo<select value={currentEditor.speed} onChange={e=>updateEditor({speed:Number(e.target.value)})}>{[.25,.5,.75,1,1.25,1.5,2].map(x=><option key={x} value={x}>{x}×</option>)}</select></label><label>Zoom<input type="range" min=".8" max="2.5" step=".05" value={currentEditor.zoom} onChange={e=>updateEditor({zoom:Number(e.target.value)})}/></label><label>Filter<select value={currentEditor.filter} onChange={e=>updateEditor({filter:e.target.value})}>{["Auto","Warm","Cool","Vivid","Noir"].map(x=><option key={x}>{x}</option>)}</select></label><label>Lautstärke<input type="range" min="0" max="1" step=".05" value={currentEditor.volume} onChange={e=>updateEditor({volume:Number(e.target.value),muted:Number(e.target.value)===0})}/></label><label>Position X<input type="range" min="-300" max="300" value={currentEditor.x} onChange={e=>updateEditor({x:Number(e.target.value)})}/></label><label>Position Y<input type="range" min="-300" max="300" value={currentEditor.y} onChange={e=>updateEditor({y:Number(e.target.value)})}/></label></div><button className="chip" onClick={resetEditor}>↺ Clip zurücksetzen</button></>}
   <div className="timeline">{editorClips.map((ec,i)=><button key={ec.id} className={"timelineClip "+(i===editorIndex?"selected":"")} onClick={()=>{setEditorIndex(i);setEditorTime(0)}}><span>{i+1}</span><strong>{ec.source.name}</strong><small>{fmt((ec.end-ec.start)/ec.speed)} · {ec.filter}</small></button>)}</div>
   <button className="mainBtn" disabled={busy||!editorClips.length} onClick={exportEdited}>💾 Bearbeitete Version exportieren</button>
  </section>}
  <div className="footer">Videoeditor47 · kein Login · kein Supabase · keine monatlichen Gebühren</div>
 </main>
}