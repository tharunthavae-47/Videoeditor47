"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Clip={id:string;name:string;url:string;duration:number};
const styles=["Cinematic","Action","Funny","Emotional","Party","Travel","Fast Cut","Relaxed"];
const lengths=[1,3,5,10];

function fmt(s:number){if(!Number.isFinite(s))return "0:00";const m=Math.floor(s/60);const sec=Math.floor(s%60).toString().padStart(2,"0");return m+":"+sec}

export default function Home(){
 const [clips,setClips]=useState<Clip[]>([]); const [length,setLength]=useState(3); const [style,setStyle]=useState("Cinematic");
 const [ratio,setRatio]=useState("9:16"); const [busy,setBusy]=useState(false); const [progress,setProgress]=useState(0); const [result,setResult]=useState<string|null>(null);
 const fileRef=useRef<HTMLInputElement>(null); const stopRef=useRef(false);
 const total=useMemo(()=>clips.reduce((a,c)=>a+c.duration,0),[clips]);
 useEffect(()=>()=>clips.forEach(c=>URL.revokeObjectURL(c.url)),[]);
 function addFiles(e:ChangeEvent<HTMLInputElement>){const fs=Array.from(e.target.files||[]);const next:Clip[]=[];let done=0; if(!fs.length)return; fs.forEach((f,i)=>{const url=URL.createObjectURL(f);const v=document.createElement("video");v.preload="metadata";v.onloadedmetadata=()=>{next.push({id:f.name+"-"+i,name:f.name,url,duration:v.duration||5});done++;if(done===fs.length)setClips(p=>[...p,...next])};v.onerror=()=>{done++;if(done===fs.length)setClips(p=>[...p,...next])};v.src=url});e.target.value=""}
 function remove(id:string){setClips(p=>p.filter(c=>c.id!==id))}
 async function render(){if(!clips.length||busy)return;setBusy(true);setResult(null);setProgress(0);stopRef.current=false;
   try{
    const target=Math.min(length*60,total); if(target<=0)throw new Error("Keine abspielbaren Videos.");
    const chosen=[...clips].sort((a,b)=>b.duration-a.duration); // simple local highlight heuristic: longest clips first
    let remaining=target; const segments:{clip:Clip;start:number;dur:number}[]=[];
    for(const c of chosen){if(remaining<=0)break;const d=Math.min(c.duration,remaining);const start=Math.max(0,(c.duration-d)/2);segments.push({clip:c,start,dur:d});remaining-=d}
    if(!segments.length)throw new Error("Keine Clips gefunden.");
    const vertical=ratio==="9:16";const wide=ratio==="16:9";const W=vertical?720:wide?1280:1080;const H=vertical?1280:wide?720:1080;
    const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Canvas nicht verfügbar.");
    const stream=canvas.captureStream(30);let recorder:MediaRecorder;const chunks:Blob[]=[];
    try{recorder=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp9"})}catch{recorder=new MediaRecorder(stream)}
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    const finished=new Promise<void>((resolve,reject)=>{recorder.onstop=()=>resolve();recorder.onerror=()=>reject(new Error("Aufnahme fehlgeschlagen"))});
    recorder.start(250);
    let elapsed=0;
    for(const seg of segments){
      const v=document.createElement("video");v.src=seg.clip.url;v.muted=true;v.playsInline=true;v.preload="auto";await new Promise<void>((res,rej)=>{v.onloadeddata=()=>res();v.onerror=()=>rej(new Error("Video konnte nicht geladen werden."))});
      await v.play();v.currentTime=seg.start;const startTime=performance.now();
      while(performance.now()-startTime<seg.dur*1000){if(stopRef.current)break; if(v.readyState>=2){const vw=v.videoWidth||W,vh=v.videoHeight||H;const scale=Math.max(W/vw,H/vh);const dw=vw*scale,dh=vh*scale;ctx.fillStyle="#000";ctx.fillRect(0,0,W,H);ctx.drawImage(v,(W-dw)/2,(H-dh)/2,dw,dh);ctx.fillStyle="rgba(0,0,0,.18)";ctx.fillRect(0,0,W,H);if(style==="Fast Cut"){ctx.fillStyle="#fff";ctx.font="700 22px Arial";ctx.fillText("VIDEOEDITOR47",24,H-30)};}
        elapsed+=16;setProgress(Math.min(99,Math.round((elapsed/(target*1000))*100)));await new Promise(r=>setTimeout(r,16));
      }
      v.pause();v.remove();
    }
    recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:"video/webm"});setResult(URL.createObjectURL(blob));setProgress(100);
   }catch(err){alert(err instanceof Error?err.message:"Export fehlgeschlagen.");}finally{setBusy(false)}
 }
 return <main className="app">
  <div className="top"><div className="logo">Videoeditor47</div><div className="badge">100% lokal · ohne Supabase</div></div>
  <section className="hero"><h1>Dein Recap.<br/>Direkt auf dem Handy.</h1><p>Videos auswählen, Stil festlegen und einen kurzen Recap erstellen. Deine Videos bleiben auf deinem Gerät.</p>
   <div className="drop"><strong>{clips.length?clips.length+" Videos ausgewählt":"Noch keine Videos"}</strong><span className="small">Mehrere Videos gleichzeitig auswählen</span><br/><label className="choose">＋ Videos auswählen<input ref={fileRef} className="hidden" type="file" accept="video/*" multiple onChange={addFiles}/></label></div>
  </section>
  {clips.length>0&&<section className="section"><h2>Deine Videos · {fmt(total)} gesamt</h2><div className="videos">{clips.map(c=><div className="videoCard" key={c.id}><button className="remove" onClick={()=>remove(c.id)}>×</button><video src={c.url} muted playsInline preload="metadata"/><div className="videoInfo">{c.name}</div></div>)}</div></section>}
  <section className="section"><h2>Recap-Länge</h2><div className="chips">{lengths.map(x=><button className={"chip "+(length===x?"active":"")} key={x} onClick={()=>setLength(x)}>{x} Min.</button>)}</div></section>
  <section className="section"><h2>Stil</h2><div className="chips">{styles.map(x=><button className={"chip "+(style===x?"active":"")} key={x} onClick={()=>setStyle(x)}>{x}</button>)}</div></section>
  <section className="section"><h2>Format</h2><div className="chips">{["9:16","16:9","1:1"].map(x=><button className={"chip "+(ratio===x?"active":"")} key={x} onClick={()=>setRatio(x)}>{x}</button>)}</div></section>
  <section className="section"><h2>Recap erstellen</h2><p className="small">V1 arbeitet komplett im Browser: Es werden keine Videos hochgeladen. Auf dem Handy kann ein längerer Export je nach Videomenge etwas dauern.</p><button className="mainBtn" disabled={!clips.length||busy} onClick={render}>{busy?"Recap wird erstellt…":"✨ Recap erstellen"}</button>{busy&&<div className="progress"><i style={{width:progress+"%"}}/></div>}</section>
  {result&&<section className="section result"><h2>Dein Recap ist fertig 🎉</h2><video controls playsInline src={result}/><a className="download" href={result} download={"Videoeditor47-Recap.webm"}>⬇️ Recap auf dem Handy speichern</a><p className="small">Tipp: In Chrome/Edge kannst du die Seite über das Menü zum Startbildschirm hinzufügen.</p></section>}
  <div className="footer">Videoeditor47 · keine Anmeldung · kein Supabase · keine monatlichen Gebühren</div>
 </main>
}