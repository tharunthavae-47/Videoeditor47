"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Clip={id:string;name:string;url:string;duration:number};
type Highlight={clip:Clip;start:number;dur:number;score:number};

const styles=["Cinematic","Action","Funny","Emotional","Party","Travel","Fast Cut","Relaxed"];
const lengths=[1,3,5,10];

function fmt(s:number){if(!Number.isFinite(s))return "0:00";const m=Math.floor(s/60);const sec=Math.floor(s%60).toString().padStart(2,"0");return m+":"+sec}

async function scoreClip(clip:Clip, style:string):Promise<Highlight[]>{
  const v=document.createElement("video"); v.src=clip.url; v.muted=true; v.playsInline=true; v.preload="auto";
  await new Promise<void>((res,rej)=>{v.onloadeddata=()=>res();v.onerror=()=>rej(new Error("Video konnte nicht analysiert werden."))});
  const canvas=document.createElement("canvas"); canvas.width=48; canvas.height=27;
  const ctx=canvas.getContext("2d",{willReadFrequently:true}); if(!ctx)throw new Error("Analyse nicht verfügbar.");
  const count=Math.max(3,Math.min(12,Math.ceil(clip.duration/3)));
  const frames:{t:number;energy:number;change:number}[]=[]; let prev:Uint8ClampedArray|null=null;
  for(let i=0;i<count;i++){
    const t=(clip.duration<1?0:(i/(count-1))*Math.max(0,clip.duration-.25));
    v.currentTime=t; await new Promise<void>(r=>{v.onseeked=()=>r()});
    ctx.drawImage(v,0,0,48,27); const data=ctx.getImageData(0,0,48,27).data;
    let brightness=0,diff=0;
    for(let p=0;p<data.length;p+=4){brightness+=(data[p]+data[p+1]+data[p+2])/3;if(prev)diff+=Math.abs(data[p]-prev[p])+Math.abs(data[p+1]-prev[p+1])+Math.abs(data[p+2]-prev[p+2])}
    const energy=brightness/(48*27*255); const change=prev?diff/(48*27*3*255):0;
    frames.push({t,energy,change}); prev=data;
  }
  v.remove();
  const highlights:Highlight[]=[];
  const window=Math.min(4.5,Math.max(2,clip.duration*.22));
  for(let i=0;i<frames.length;i++){
    const f=frames[i];
    const motion=f.change;
    const bright=1-Math.abs(f.energy-.58);
    let styleBonus=0;
    if(style==="Relaxed"||style==="Emotional")styleBonus=(1-motion)*.22;
    if(style==="Action"||style==="Fast Cut")styleBonus=motion*.3;
    if(style==="Funny"||style==="Party")styleBonus=Math.min(1,motion*1.5)*.18;
    const score=motion*.62+bright*.2+styleBonus;
    highlights.push({clip,start:Math.max(0,Math.min(clip.duration-window,f.t-window/2)),dur:window,score});
  }
  return highlights.sort((a,b)=>b.score-a.score).slice(0,Math.min(3,highlights.length));
}

export default function Home(){
 const [clips,setClips]=useState<Clip[]>([]); const [length,setLength]=useState(3); const [style,setStyle]=useState("Cinematic");
 const [ratio,setRatio]=useState("9:16"); const [busy,setBusy]=useState(false); const [progress,setProgress]=useState(0); const [result,setResult]=useState<string|null>(null); const [analysis,setAnalysis]=useState("");
 const fileRef=useRef<HTMLInputElement>(null);
 const total=useMemo(()=>clips.reduce((a,c)=>a+c.duration,0),[clips]);
 useEffect(()=>()=>clips.forEach(c=>URL.revokeObjectURL(c.url)),[]);
 function addFiles(e:ChangeEvent<HTMLInputElement>){const fs=Array.from(e.target.files||[]);const next:Clip[]=[];let done=0;if(!fs.length)return;fs.forEach((f,i)=>{const url=URL.createObjectURL(f);const v=document.createElement("video");v.preload="metadata";v.onloadedmetadata=()=>{next.push({id:f.name+"-"+i,name:f.name,url,duration:v.duration||5});done++;if(done===fs.length)setClips(p=>[...p,...next])};v.onerror=()=>{done++;if(done===fs.length)setClips(p=>[...p,...next])};v.src=url});e.target.value=""}
 function remove(id:string){setClips(p=>p.filter(c=>c.id!==id))}
 async function render(){
  if(!clips.length||busy)return; setBusy(true);setResult(null);setProgress(0);
  try{
   const target=Math.min(length*60,total); if(target<=0)throw new Error("Keine abspielbaren Videos.");
   setAnalysis("1/3 · Videos werden analysiert …");
   const all:Highlight[]=[]; for(let i=0;i<clips.length;i++){all.push(...await scoreClip(clips[i],style));setProgress(Math.round(((i+1)/clips.length)*30))}
   all.sort((a,b)=>b.score-a.score);
   const chosen:Highlight[]=[]; let remaining=target;
   for(const h of all){
     if(remaining<=0)break;
     const overlap=chosen.some(x=>x.clip.id===h.clip.id&&Math.abs(x.start-h.start)<h.dur*.8);
     if(overlap)continue;
     const dur=Math.min(h.dur,remaining);chosen.push({...h,dur});remaining-=dur;
   }
   if(remaining>0){for(const c of clips){if(remaining<=0)break;const dur=Math.min(remaining,Math.min(3,c.duration));chosen.push({clip:c,start:Math.max(0,(c.duration-dur)/2),dur,score:0});remaining-=dur}}
   if(!chosen.length)throw new Error("Keine Highlights gefunden.");
   setAnalysis("2/3 · Beste Szenen ausgewählt …");setProgress(40);
   const vertical=ratio==="9:16",wide=ratio==="16:9";const W=vertical?720:wide?1280:1080,H=vertical?1280:wide?720:1080;
   const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Canvas nicht verfügbar.");
   const stream=canvas.captureStream(30);let recorder:MediaRecorder;const chunks:Blob[]=[];
   try{recorder=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp9"})}catch{recorder=new MediaRecorder(stream)}
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   const finished=new Promise<void>((resolve,reject)=>{recorder.onstop=()=>resolve();recorder.onerror=()=>reject(new Error("Aufnahme fehlgeschlagen"))});
   recorder.start(250); let doneTime=0;
   for(let si=0;si<chosen.length;si++){
    const seg=chosen[si],v=document.createElement("video");v.src=seg.clip.url;v.muted=true;v.playsInline=true;v.preload="auto";
    await new Promise<void>((res,rej)=>{v.onloadeddata=()=>res();v.onerror=()=>rej(new Error("Video konnte nicht geladen werden."))});
    await v.play();v.currentTime=seg.start;const start=performance.now();
    while(performance.now()-start<seg.dur*1000){
      if(v.readyState>=2){const vw=v.videoWidth||W,vh=v.videoHeight||H,scale=Math.max(W/vw,H/vh),dw=vw*scale,dh=vh*scale;ctx.fillStyle="#000";ctx.fillRect(0,0,W,H);ctx.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh);
        const fade=Math.min(1,Math.min((performance.now()-start)/350,(seg.dur*1000-(performance.now()-start))/350));ctx.fillStyle="rgba(0,0,0,"+(1-Math.max(0,fade))*.45+")";ctx.fillRect(0,0,W,H);
        if(style==="Fast Cut"){ctx.fillStyle="#fff";ctx.font="700 22px Arial";ctx.fillText("VIDEOEDITOR47",24,H-30)}
      }
      doneTime+=16;setProgress(40+Math.min(59,Math.round(doneTime/(target*1000)*59)));await new Promise(r=>setTimeout(r,16));
    }
    v.pause();v.remove();
   }
   recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());setAnalysis("3/3 · Recap fertig!");setProgress(100);
   setResult(URL.createObjectURL(new Blob(chunks,{type:"video/webm"})));
  }catch(err){alert(err instanceof Error?err.message:"Recap fehlgeschlagen.");}finally{setBusy(false)}
 }
 return <main className="app">
  <div className="top"><div className="logo">Videoeditor47</div><div className="badge">100% lokal · ohne Supabase</div></div>
  <section className="hero"><h1>Dein Recap.<br/>Direkt auf dem Handy.</h1><p>Videoeditor47 analysiert deine Clips lokal und sucht automatisch nach sichtbaren Bewegungen, Szenenwechseln und interessanten Momenten.</p>
   <div className="drop"><strong>{clips.length?clips.length+" Videos ausgewählt":"Noch keine Videos"}</strong><span className="small">Mehrere Videos gleichzeitig auswählen</span><br/><label className="choose">＋ Videos auswählen<input ref={fileRef} className="hidden" type="file" accept="video/*" multiple onChange={addFiles}/></label></div>
  </section>
  {clips.length>0&&<section className="section"><h2>Deine Videos · {fmt(total)} gesamt</h2><div className="videos">{clips.map(c=><div className="videoCard" key={c.id}><button className="remove" onClick={()=>remove(c.id)}>×</button><video src={c.url} muted playsInline preload="metadata"/><div className="videoInfo">{c.name}</div></div>)}</div></section>}
  <section className="section"><h2>Recap-Länge</h2><div className="chips">{lengths.map(x=><button className={"chip "+(length===x?"active":"")} key={x} onClick={()=>setLength(x)}>{x} Min.</button>)}</div></section>
  <section className="section"><h2>Stil</h2><div className="chips">{styles.map(x=><button className={"chip "+(style===x?"active":"")} key={x} onClick={()=>setStyle(x)}>{x}</button>)}</div></section>
  <section className="section"><h2>Format</h2><div className="chips">{["9:16","16:9","1:1"].map(x=><button className={"chip "+(ratio===x?"active":"")} key={x} onClick={()=>setRatio(x)}>{x}</button>)}</div></section>
  <section className="section"><h2>Recap erstellen</h2><p className="small">Die Analyse läuft direkt auf deinem Handy. Es werden keine Videos hochgeladen. Videoeditor47 bewertet kleine Vorschau-Frames und sucht nach Bewegung, Bildwechseln und passenden Momenten für deinen gewählten Stil.</p><button className="mainBtn" disabled={!clips.length||busy} onClick={render}>{busy?"Recap wird erstellt …":"✨ Automatischen Recap erstellen"}</button>{busy&&<><p className="small">{analysis}</p><div className="progress"><i style={{width:progress+"%"}}/></div></>}</section>
  {result&&<section className="section result"><h2>Dein Recap ist fertig 🎉</h2><video controls playsInline src={result}/><a className="download" href={result} download={"Videoeditor47-Recap.webm"}>⬇️ Recap auf dem Handy speichern</a><p className="small">Die Verarbeitung war komplett lokal. Deine Originalvideos wurden nicht hochgeladen.</p></section>}
  <div className="footer">Videoeditor47 · keine Anmeldung · kein Supabase · keine monatlichen Gebühren</div>
 </main>
}