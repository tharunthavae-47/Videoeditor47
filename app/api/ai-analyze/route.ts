import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Frame = { time:number; data:string };

export async function POST(req:Request){
  try{
    const apiKey=process.env.GEMINI_API_KEY;
    if(!apiKey) return NextResponse.json({error:"GEMINI_API_KEY fehlt. Bitte in Vercel unter Environment Variables eintragen."},{status:503});
    const body=await req.json() as {style?:string;duration?:number;frames?:Frame[]};
    const frames=Array.isArray(body.frames)?body.frames.slice(0,12):[];
    if(!frames.length) return NextResponse.json({error:"Keine Analysebilder erhalten."},{status:400});

    const parts=[
      {text:
`Du bist ein professioneller Video-Editor. Analysiere die folgenden Einzelbilder eines Videos.
Video-Länge: ${Number(body.duration||0).toFixed(1)} Sekunden.
Gewünschter Stil: ${body.style||"Cinematic"}.

Wähle 1 bis 4 besonders interessante Momente für einen professionellen Recap.
Bewerte dabei sichtbare Action, Personen/Emotionen, interessante Komposition, deutliche Szenenwechsel und stilistische Passung.
Wichtig: Erfinde keine Ereignisse, die nicht sichtbar sind. Die angegebenen Zeiten gehören jeweils zum gezeigten Einzelbild.
Gib ausschließlich gültiges JSON zurück:
{"highlights":[{"start":12.3,"duration":3.5,"score":0.92,"reason":"kurze Beschreibung"}]}
`},
      ...frames.flatMap((f)=>[
        {text:`Frame bei ${Number(f.time).toFixed(2)} Sekunden:`},
        {inline_data:{mime_type:"image/jpeg",data:f.data}}
      ])
    ];

    const endpoint="https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+encodeURIComponent(apiKey);
    const response=await fetch(endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts}],
        generationConfig:{
          temperature:0.2,
          responseMimeType:"application/json",
          responseSchema:{
            type:"OBJECT",
            properties:{
              highlights:{
                type:"ARRAY",
                items:{
                  type:"OBJECT",
                  properties:{
                    start:{type:"NUMBER"},
                    duration:{type:"NUMBER"},
                    score:{type:"NUMBER"},
                    reason:{type:"STRING"}
                  },
                  required:["start","duration","score","reason"]
                }
              }
            },
            required:["highlights"]
          }
        }
      })
    });
    const result=await response.json();
    if(!response.ok){
      const message=result?.error?.message||"Gemini API Fehler";
      return NextResponse.json({error:message},{status:502});
    }
    const text=result?.candidates?.[0]?.content?.parts?.map((x:{text?:string})=>x.text||"").join("")||"";
    const parsed=JSON.parse(text);
    return NextResponse.json(parsed);
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"KI-Analyse fehlgeschlagen."},{status:500});
  }
}
