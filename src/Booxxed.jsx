import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";   // npm install three  (in booxxed-frontend)

// ─── Constants ────────────────────────────────────────────────────────────────
const CONTINENTS = ["Africa","Americas","Asia","Europe","Oceania"];
const COUNTRY_TO_CONTINENT = {
  "Nigeria":"Africa","Kenya":"Africa","Ghana":"Africa","South Africa":"Africa","Ethiopia":"Africa","Egypt":"Africa","Senegal":"Africa","Morocco":"Africa","Tanzania":"Africa","Zimbabwe":"Africa","Uganda":"Africa","Cameroon":"Africa","Algeria":"Africa","Sudan":"Africa",
  "United States":"Americas","USA":"Americas","Canada":"Americas","Mexico":"Americas","Brazil":"Americas","Argentina":"Americas","Colombia":"Americas","Chile":"Americas","Peru":"Americas","Cuba":"Americas","Jamaica":"Americas","Haiti":"Americas","Venezuela":"Americas","Ecuador":"Americas",
  "Japan":"Asia","China":"Asia","India":"Asia","South Korea":"Asia","Korea":"Asia","Vietnam":"Asia","Indonesia":"Asia","Philippines":"Asia","Thailand":"Asia","Pakistan":"Asia","Bangladesh":"Asia","Iran":"Asia","Iraq":"Asia","Turkey":"Asia","Israel":"Asia","Palestine":"Asia","Syria":"Asia","Afghanistan":"Asia","Nepal":"Asia","Sri Lanka":"Asia","Myanmar":"Asia","Malaysia":"Asia","Singapore":"Asia","Taiwan":"Asia",
  "United Kingdom":"Europe","UK":"Europe","England":"Europe","France":"Europe","Germany":"Europe","Spain":"Europe","Italy":"Europe","Russia":"Europe","Poland":"Europe","Netherlands":"Europe","Sweden":"Europe","Norway":"Europe","Denmark":"Europe","Finland":"Europe","Portugal":"Europe","Greece":"Europe","Ireland":"Europe","Switzerland":"Europe","Austria":"Europe","Belgium":"Europe","Czech Republic":"Europe","Hungary":"Europe","Romania":"Europe","Ukraine":"Europe","Belarus":"Europe","Serbia":"Europe","Croatia":"Europe","Slovakia":"Europe","Bulgaria":"Europe","Slovenia":"Europe","Albania":"Europe","Lithuania":"Europe","Latvia":"Europe","Estonia":"Europe","Iceland":"Europe","Luxembourg":"Europe","Malta":"Europe","Cyprus":"Europe",
  "Australia":"Oceania","New Zealand":"Oceania","Papua New Guinea":"Oceania","Fiji":"Oceania","Samoa":"Oceania","Tonga":"Oceania"
};

// ─── Global book-level polls (keyed by bookId) ────────────────────────────────
// This is the single source of truth for all character votes — shared across every
// log/review of the same book, exactly like a real backend would store them.
const INITIAL_POLLS = {
  "OL16805415W":    { characters:["Ifemelu","Obinze","Aunty Uju","Dike"],       votes:{Ifemelu:18,Obinze:9,"Aunty Uju":4,Dike:6},   userVote:null },
  "OL17762217W": { characters:["Sunja","Isak","Noa","Mozasu"],               votes:{Sunja:31,Isak:8,Noa:14,Mozasu:11},            userVote:null },
  "OL20150260W": { characters:["Marianne","Connell","Lorraine","Jamie"],     votes:{Marianne:22,Connell:19,Lorraine:8,Jamie:3},   userVote:null },
};

const INITIAL_LOGS = [
  { id:1, bookId:"OL16805415W",    title:"Americanah",    author:"Chimamanda Ngozi Adichie", year:2013, coverId:8474037,  country:"Nigeria",      continent:"Africa",   rating:4.5, tags:["diaspora","identity","race"],             comment:"A sweeping and unflinching portrayal of identity across continents. Adichie's prose is electric — every sentence earns its place.", date:"2024-03-12" },
  { id:2, bookId:"OL17762217W", title:"Pachinko",      author:"Min Jin Lee",              year:2017, coverId:8044605,  country:"South Korea",  continent:"Asia",     rating:5,   tags:["multigenerational","korea","immigration"], comment:"The most devastating and beautiful book I've read in years. Four generations of a Korean family — each chapter felt like a full novel.", date:"2024-01-28" },
  { id:3, bookId:"OL20150260W", title:"Normal People", author:"Sally Rooney",             year:2018, coverId:8794265,  country:"Ireland",      continent:"Europe",   rating:3.5, tags:["ireland","class","relationships"],         comment:"Rooney is technically brilliant — the dialogue is flawless. I found Connell more compelling than Marianne, which I suspect is the point.", date:"2023-11-05" },
];
const INITIAL_FAVS = { Africa:"OL16805415W", Americas:null, Asia:"OL17762217W", Europe:"OL20150260W", Oceania:null };

// Every user always has this shelf; it mirrors the full reading log and the two
// other slots are free for hand-picked, customisable shelves (3 max in total).
const DEFAULT_SHELVES = [{ id:"all", name:"All my books", color:null, isDefault:true, bookIds:[] }];
const MAX_SHELVES = 3;

const TAG_SUGGESTIONS = ["literary fiction","coming of age","magical realism","diaspora","historical","debut","short stories","unreliable narrator","slow burn","family saga","colonialism","feminism","queerness","war","immigration","mythology","satire","thriller","romance","poetry"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function coverUrl(coverId, size="M") {
  if (!coverId) return null;
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a), ms); };
}
function inferCountry(olBook) {
  const all = [...(olBook.subject_places||[]), ...(olBook.subject||[])];
  for (const s of all)
    for (const country of Object.keys(COUNTRY_TO_CONTINENT))
      if (s.toLowerCase().includes(country.toLowerCase())) return country;
  return null;
}

// ─── Backend API client ───────────────────────────────────────────────────────
// Default: local Flask. To point elsewhere, set window.BOOXXED_API_URL before the
// app mounts (e.g. a <script> tag in index.html) or edit the constant below.
// NOTE: backend connection only works when running locally (Vite) — the Claude.ai
// preview sandbox blocks network calls, where the app falls back to demo mode.
const API_BASE = (typeof window !== "undefined" && window.BOOXXED_API_URL) || "http://localhost:5001/api";

let _token = null;
try { _token = window.localStorage.getItem("booxxed_token"); } catch {}

function setToken(t) {
  _token = t;
  try {
    if (t) window.localStorage.setItem("booxxed_token", t);
    else   window.localStorage.removeItem("booxxed_token");
  } catch {}
}

async function apiFetch(path, { method="GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(_token ? { "Authorization": `Bearer ${_token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

const api = {
  register: (username,email,password) => apiFetch("/auth/register",{method:"POST",body:{username,email,password}}),
  login:    (identifier,password)     => apiFetch("/auth/login",   {method:"POST",body:{identifier,password}}),
  me:       ()                        => apiFetch("/auth/me"),
  getLogs:  ()                        => apiFetch("/logs"),
  createLog:(payload)                 => apiFetch("/logs",{method:"POST",body:payload}),
  updateLog:(id,payload)              => apiFetch(`/logs/${id}`,{method:"PATCH",body:payload}),
  deleteLog:(id)                      => apiFetch(`/logs/${id}`,{method:"DELETE"}),
  getBookDetail:(olKey)               => apiFetch(`/books${olKey}`),          // creates poll server-side
  getPoll:  (olKey)                   => apiFetch(`/polls${olKey}`),
  votePoll: (olKey,characterId)       => apiFetch(`/polls${olKey}/vote`,{method:"POST",body:{character_id:characterId}}),
  getFavourites:()                    => apiFetch("/favourites"),
  setFavourite:(continent,olKey)      => apiFetch(`/favourites/${continent}`,{method:"PUT",body:{ol_key:olKey}}),
  clearFavourite:(continent)          => apiFetch(`/favourites/${continent}`,{method:"DELETE"}),
  getShelves:   ()                    => apiFetch("/shelves"),
  createShelf:  (name,color)          => apiFetch("/shelves",{method:"POST",body:{name,color}}),
  updateShelf:  (id,patch)            => apiFetch(`/shelves/${id}`,{method:"PATCH",body:patch}),
  deleteShelf:  (id)                  => apiFetch(`/shelves/${id}`,{method:"DELETE"}),
  setShelfBooks:(id,ol_keys)          => apiFetch(`/shelves/${id}/books`,{method:"PUT",body:{ol_keys}}),
  searchUsers:  (q)                   => apiFetch(`/users?q=${encodeURIComponent(q)}`),
  getUser:      (username)            => apiFetch(`/users/${encodeURIComponent(username)}`),
};

// ─── Backend → frontend shape normalizers ─────────────────────────────────────
function normalizeLog(l) {
  return {
    id:l.id, bookId:l.book.ol_key, title:l.book.title, author:l.book.author||"Unknown",
    year:l.book.year, coverId:l.book.cover_id, country:l.country, continent:l.continent,
    rating:l.rating, tags:l.tags||[], comment:l.comment||"",
    date:(l.logged_at||"").split("T")[0],
  };
}

function normalizeShelf(s) {
  return { id:s.id, name:s.name, color:s.color||null, isDefault:s.is_default, bookIds:s.ol_keys||[] };
}

// Poll: backend returns {characters:[{id,name,votes}], user_vote:<charId>, total_votes}
// Frontend CharacterPoll consumes {characters:[names], votes:{name:n}, userVote:name}.
// We keep _ids (name → id) so votes can be sent back by id.
function normalizePoll(p) {
  if (!p) return null;
  const ids = Object.fromEntries(p.characters.map(c=>[c.name,c.id]));
  const byId = Object.fromEntries(p.characters.map(c=>[c.id,c.name]));
  return {
    characters: p.characters.map(c=>c.name),
    votes: Object.fromEntries(p.characters.map(c=>[c.name,c.votes])),
    userVote: p.user_vote ? byId[p.user_vote] : null,
    _ids: ids,
  };
}

// ─── Shared UI atoms ──────────────────────────────────────────────────────────
function StarRating({ value, onChange, size=20, readOnly=false }) {
  const [hover, setHover] = useState(null);
  const display = hover ?? value;
  return (
    <div style={{display:"flex",gap:2,cursor:readOnly?"default":"pointer"}} onMouseLeave={()=>!readOnly&&setHover(null)}>
      {[1,2,3,4,5].map(n=>{
        const full=display>=n, half=!full&&display>=n-0.5;
        return (
          <span key={n} style={{position:"relative",width:size,height:size,display:"inline-block"}}
            onMouseMove={readOnly?null:e=>{const r=e.currentTarget.getBoundingClientRect();setHover(e.clientX-r.left<r.width/2?n-0.5:n);}}
            onClick={readOnly?null:()=>onChange&&onChange(hover??n)}>
            <svg width={size} height={size} viewBox="0 0 24 24">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill={full?"#C8802A":"#ddd"} stroke={full||half?"#C8802A":"#ccc"} strokeWidth="1.2"/>
              {half&&<><clipPath id={`h${n}`}><rect x="0" y="0" width="12" height="24"/></clipPath><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="#C8802A" clipPath={`url(#h${n})`}/></>}
            </svg>
          </span>
        );
      })}
    </div>
  );
}

function BookCover({ coverId, title, size=52 }) {
  const [err,setErr] = useState(false);
  const url = coverUrl(coverId, size>80?"L":"M");
  if (url&&!err) return <img src={url} alt={title} onError={()=>setErr(true)} style={{width:size,height:size*1.4,objectFit:"cover",borderRadius:6,display:"block",background:"#e8e0d4",flexShrink:0}}/>;
  const initials=(title||"?").split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase();
  return <div style={{width:size,height:size*1.4,borderRadius:6,background:"#3d2b1f",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:"#c8a96e",fontSize:size*0.28,fontWeight:700,fontFamily:"Georgia,serif"}}>{initials}</span></div>;
}

function ContinentBadge({ continent }) {
  const colors={Africa:"#7B4F2E",Americas:"#2E5C4F",Asia:"#2E3F6F",Europe:"#5C2E4F",Oceania:"#2E5C5C"};
  return <span style={{background:colors[continent]||"#555",color:"#fff",fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:4,letterSpacing:"0.04em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{continent}</span>;
}

function Tag({ label, onRemove }) {
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,background:"#f0ebe4",color:"#6b5740",fontSize:12,padding:"3px 8px",borderRadius:12,border:"1px solid #ddd3c5",whiteSpace:"nowrap"}}>{label}{onRemove&&<span onClick={onRemove} style={{cursor:"pointer",color:"#a08060",fontWeight:700,fontSize:13}}>×</span>}</span>;
}

// ─── Global Character Poll ────────────────────────────────────────────────────
// Used in three places: LogModal step 2, LogCard, BookPage.
// `poll`      = { characters, votes, userVote } — the global shared object for this book
// `onVote`    = (character) => void — updates the global poll in App state
// `context`   = "modal" | "card" | "page"  (controls heading size/padding)
function CharacterPoll({ poll, onVote, context="card" }) {
  const [revealed, setRevealed] = useState(false);
  if (!poll || poll.characters.length === 0) return null;

  const total = Object.values(poll.votes).reduce((a,b)=>a+b, 0);
  const leading = total > 0
    ? poll.characters.reduce((a,b)=> (poll.votes[b]||0) > (poll.votes[a]||0) ? b : a)
    : null;

  const isModal = context === "modal";
  const isPage  = context === "page";

  return (
    <div style={{
      marginTop: isModal ? 0 : 12,
      borderRadius: 8,
      overflow: "hidden",
      border: "1px solid #e8dfd3",
    }}>
      {/* Spoiler gate */}
      {!revealed ? (
        <div style={{padding: isModal?"16px 18px":"12px 14px", background:"#fdf6ee", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12}}>
          <div>
            <p style={{margin:0, fontSize: isModal?14:13, fontWeight:600, color:"#5a3e2b"}}>
              {isModal ? "Vote for your favourite character" : "Favourite character poll"}
            </p>
            <p style={{margin:"3px 0 0", fontSize:12, color:"#a08060"}}>
              ⚠ Contains character names — may include spoilers
            </p>
          </div>
          <button onClick={()=>setRevealed(true)}
            style={{flexShrink:0, background:"#1e1208", border:"none", color:"#c8a96e", fontSize:13, fontWeight:600, padding:"7px 14px", borderRadius:6, cursor:"pointer", fontFamily:"Georgia,serif", whiteSpace:"nowrap"}}>
            Reveal poll
          </button>
        </div>
      ) : (
        <div style={{padding: isModal?"16px 18px":"12px 14px", background:"#faf7f3"}}>
          <div style={{display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:12}}>
            <p style={{margin:0, fontSize: isPage?15:13, fontWeight:600, color:"#5a3e2b"}}>
              Favourite character
            </p>
            <span style={{fontSize:11, color:"#b09070"}}>{total} vote{total!==1?"s":""}</span>
          </div>

          {poll.characters.map(ch=>{
            const v=poll.votes[ch]||0;
            const pct=total>0?Math.round(v/total*100):0;
            const voted=poll.userVote===ch;
            const isLeader=ch===leading&&total>0;
            return (
              <div key={ch} style={{marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
                {/* Radio circle — click to vote or change vote */}
                <button onClick={()=>onVote(ch)} title={voted?"Your current vote":"Vote for "+ch}
                  style={{width:18,height:18,borderRadius:"50%",flexShrink:0,cursor:"pointer",padding:0,
                    border:voted?"2px solid #C8802A":"2px solid #b8a890",
                    background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",transition:"border-color 0.15s"}}>
                  {voted&&<span style={{width:9,height:9,borderRadius:"50%",background:"#C8802A",display:"block"}}/>}
                </button>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:13, marginBottom:4}}>
                    <span style={{color:voted?"#8B4513":"#3c2a1a", fontWeight:voted?600:400, display:"flex", alignItems:"center", gap:5}}>
                      {ch}
                      {isLeader&&<span style={{fontSize:10,background:"#faeeda",color:"#8B4513",padding:"1px 5px",borderRadius:4,fontWeight:600}}>leading</span>}
                      {voted&&<span style={{fontSize:10,background:"#C8802A",color:"#fff",padding:"1px 5px",borderRadius:4}}>your vote</span>}
                    </span>
                    <span style={{color:"#a08060", fontSize:12}}>{pct}%</span>
                  </div>
                  <div style={{height:8, background:"#e8dfd3", borderRadius:4, overflow:"hidden"}}>
                    <div style={{height:"100%", width:`${pct}%`, background:voted?"#C8802A":"#c8a96e", borderRadius:4, transition:"width 0.5s ease"}}/>
                  </div>
                </div>
              </div>
            );
          })}

          <p style={{margin:"8px 0 0", fontSize:12, color:"#b09070"}}>
            {poll.userVote ? "Select another circle to change your vote" : "Select a circle to cast your vote"}
          </p>

          <button onClick={()=>setRevealed(false)}
            style={{marginTop:10, background:"none", border:"none", color:"#b09070", fontSize:12, cursor:"pointer", padding:0, fontFamily:"Georgia,serif"}}>
            Hide poll
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Country name lookup (ISO numeric → English name) ─────────────────────────
const COUNTRY_NAMES = {"004":"Afghanistan","008":"Albania","012":"Algeria","024":"Angola","032":"Argentina","036":"Australia","040":"Austria","050":"Bangladesh","056":"Belgium","064":"Bhutan","068":"Bolivia","076":"Brazil","100":"Bulgaria","116":"Cambodia","120":"Cameroon","124":"Canada","144":"Sri Lanka","152":"Chile","156":"China","170":"Colombia","180":"DR Congo","192":"Cuba","203":"Czech Republic","208":"Denmark","218":"Ecuador","818":"Egypt","231":"Ethiopia","246":"Finland","250":"France","276":"Germany","288":"Ghana","300":"Greece","320":"Guatemala","332":"Haiti","340":"Honduras","348":"Hungary","356":"India","360":"Indonesia","364":"Iran","368":"Iraq","372":"Ireland","376":"Israel","380":"Italy","388":"Jamaica","392":"Japan","400":"Jordan","398":"Kazakhstan","404":"Kenya","408":"North Korea","410":"South Korea","418":"Laos","422":"Lebanon","426":"Lesotho","430":"Liberia","434":"Libya","484":"Mexico","504":"Morocco","508":"Mozambique","516":"Namibia","524":"Nepal","528":"Netherlands","554":"New Zealand","566":"Nigeria","578":"Norway","586":"Pakistan","591":"Panama","598":"Papua New Guinea","600":"Paraguay","604":"Peru","608":"Philippines","616":"Poland","620":"Portugal","642":"Romania","643":"Russia","682":"Saudi Arabia","686":"Senegal","694":"Sierra Leone","703":"Slovakia","705":"Slovenia","706":"Somalia","710":"South Africa","724":"Spain","729":"Sudan","752":"Sweden","756":"Switzerland","760":"Syria","158":"Taiwan","762":"Tajikistan","764":"Thailand","768":"Togo","780":"Trinidad and Tobago","788":"Tunisia","792":"Turkey","800":"Uganda","804":"Ukraine","826":"United Kingdom","840":"United States","858":"Uruguay","860":"Uzbekistan","862":"Venezuela","704":"Vietnam","887":"Yemen","894":"Zambia","716":"Zimbabwe","275":"Palestine"};

// ─── Reading Map (2D Mercator, zoomable, coloured oceans) ─────────────────
function ReadingGlobe({ logs, onCountryClick }) {
  const canvasRef  = useRef(null);
  const tooltipRef = useRef(null);
  const s = useRef({
    zoom:1, panX:0, panY:0,
    dragging:false, lastX:0, lastY:0,
    features:null, hovered:null,
    readCountries:new Set(), countryCount:{},
  });

  useEffect(()=>{
    s.current.readCountries = new Set(logs.map(l=>l.country).filter(Boolean));
    const cc={}; logs.forEach(l=>{ if(l.country) cc[l.country]=(cc[l.country]||0)+1; });
    s.current.countryCount = cc;
    draw();
  }, [logs]);

  // True Mercator (no vertical stretch) cropped to inhabited latitudes.
  // Longitude spans the full width; latitude keeps the same pixels-per-degree as
  // longitude, and the resulting band is centred vertically in the canvas.
  const LAT_TOP = 80, LAT_BOTTOM = -56;
  function mercY(latDeg) {
    const r = Math.max(-85, Math.min(85, latDeg)) * Math.PI / 180;
    return Math.log(Math.tan(Math.PI/4 + r/2));
  }
  function project(lon, lat, W) {
    const st = s.current;
    const H = canvasRef.current ? canvasRef.current.height : W;
    // pixels-per-radian shared by both axes → no distortion
    const scale = W / (2 * Math.PI);
    const x = (lon + 180) / 360 * W;
    const top = mercY(LAT_TOP);
    const bandH = (top - mercY(LAT_BOTTOM)) * scale;   // natural height of the band
    const yOffset = (H - bandH) / 2;                   // centre it in the canvas
    const y = (top - mercY(lat)) * scale + yOffset;
    return [ x*st.zoom + st.panX, y*st.zoom + st.panY ];
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const st = s.current;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = "#a9d3e0";          // ocean
    ctx.fillRect(0, 0, W, H);

    if (!st.features) {
      ctx.fillStyle="#5a7a85"; ctx.font="14px Georgia,serif"; ctx.textAlign="center";
      ctx.fillText("Loading map…", W/2, H/2);
      return;
    }

    for (const feat of st.features) {
      const id = String(feat.id).padStart(3,"0");
      if (id === "010") continue;               // skip Antarctica
      const name  = COUNTRY_NAMES[id] || "";
      const isRead= st.readCountries.has(name);
      const isHov = st.hovered===name;
      const count = st.countryCount[name]||0;
      const polys = feat.geometry.type==="Polygon"?[feat.geometry.coordinates]:feat.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          // Antimeridian fix: a ring whose longitudes span >180° (e.g. Russia,
          // Fiji) wraps across the date line. Shift negative lons by +360 so the
          // polygon stays continuous instead of streaking across the whole map.
          let minLon=180, maxLon=-180;
          for (const [lon] of ring){ if(lon<minLon)minLon=lon; if(lon>maxLon)maxLon=lon; }
          const wraps = (maxLon - minLon) > 180;

          ctx.beginPath(); let first=true;
          for (const [lon,lat] of ring) {
            const adjLon = wraps && lon < 0 ? lon + 360 : lon;
            const [px,py]=project(adjLon,lat,W);
            if (first){ctx.moveTo(px,py);first=false;}else ctx.lineTo(px,py);
          }
          ctx.closePath();
          if (isRead) { const a=Math.min(1,0.6+count*0.12); ctx.fillStyle=isHov?`rgba(220,140,40,${a})`:`rgba(200,128,42,${a})`; }
          else { ctx.fillStyle=isHov?"#e8e0d0":"#f3ecdd"; }
          ctx.fill();
          ctx.strokeStyle="#8a9aa0"; ctx.lineWidth=0.4; ctx.stroke();
        }
      }
    }
  }

  useEffect(()=>{
    const loadTopo = () => new Promise(res=>{
      if (window.topojson){res();return;}
      const sc=document.createElement("script");
      sc.src="https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js";
      sc.onload=res; document.head.appendChild(sc);
    });
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then(r=>r.json())
      .then(async topo=>{
        await loadTopo();
        s.current.features = window.topojson.feature(topo, topo.objects.countries).features;
        draw();
      })
      .catch(()=>{ draw(); });
  }, []);

  function hitTest(mx, my) {
    const canvas=canvasRef.current, st=s.current;
    if (!canvas||!st.features) return null;
    const W=canvas.width, H=canvas.height;
    const rect=canvas.getBoundingClientRect();
    const sx=(mx-rect.left)*(W/rect.width), sy=(my-rect.top)*(H/rect.height);
    const off=document.createElement("canvas").getContext("2d");
    off.canvas.width=W; off.canvas.height=H;
    for (const feat of st.features) {
      const id=String(feat.id).padStart(3,"0");
      if (id === "010") continue;               // skip Antarctica
      const polys=feat.geometry.type==="Polygon"?[feat.geometry.coordinates]:feat.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) {
        let minLon=180, maxLon=-180;
        for (const [lon] of ring){ if(lon<minLon)minLon=lon; if(lon>maxLon)maxLon=lon; }
        const wraps=(maxLon-minLon)>180;
        off.beginPath(); let first=true;
        for (const [lon,lat] of ring) {
          const adjLon = wraps && lon < 0 ? lon + 360 : lon;
          const [px,py]=project(adjLon,lat,W);
          if(first){off.moveTo(px,py);first=false;}else off.lineTo(px,py);
        }
        off.closePath();
        if (off.isPointInPath(sx,sy)) return COUNTRY_NAMES[id]||null;
      }
    }
    return null;
  }

  function clampPan() {
    const canvas=canvasRef.current, st=s.current;
    const W=canvas.width, H=canvas.height;
    const mapW=W*st.zoom, mapH=H*st.zoom;
    st.panX=Math.min(0,Math.max(W-mapW, st.panX));
    st.panY=Math.min(0,Math.max(H-mapH, st.panY));
  }

  function handleWheel(e){
    e.preventDefault();
    const canvas=canvasRef.current, st=s.current;
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(canvas.width/rect.width);
    const my=(e.clientY-rect.top)*(canvas.height/rect.height);
    const factor=e.deltaY<0?1.15:1/1.15;
    const newZoom=Math.max(1,Math.min(8,st.zoom*factor));
    const ratio=newZoom/st.zoom;
    st.panX=mx-ratio*(mx-st.panX); st.panY=my-ratio*(my-st.panY);
    st.zoom=newZoom; clampPan(); draw();
  }
  function handleMouseDown(e){ const st=s.current; st.dragging=true; st.moved=false; st.lastX=e.clientX; st.lastY=e.clientY; e.currentTarget.style.cursor="grabbing"; }
  function handleMouseUp(e){
    const st=s.current;
    st.dragging=false; e.currentTarget.style.cursor="grab";
    if (!st.moved) {                              // a real click, not a drag
      const name=hitTest(e.clientX,e.clientY);
      if (name && onCountryClick) onCountryClick(name);
    }
  }
  function handleMouseLeave(e){ s.current.dragging=false; s.current.hovered=null; if(tooltipRef.current)tooltipRef.current.style.display="none"; draw(); e.currentTarget.style.cursor="grab"; }
  function handleMouseMove(e){
    const st=s.current;
    if (st.dragging){
      const dx=e.clientX-st.lastX, dy=e.clientY-st.lastY;
      if (Math.abs(dx)+Math.abs(dy)>3) st.moved=true;   // treat as drag past a small threshold
      st.panX+=dx; st.panY+=dy; st.lastX=e.clientX; st.lastY=e.clientY;
      clampPan(); draw();
      if(tooltipRef.current) tooltipRef.current.style.display="none";
    } else {
      const name=hitTest(e.clientX,e.clientY);
      if (name!==st.hovered){
        st.hovered=name; draw();
        canvasRef.current.style.cursor = name ? "pointer" : "grab";
        if (tooltipRef.current){
          if (name){
            const rect=canvasRef.current.getBoundingClientRect();
            const count=st.countryCount[name]||0;
            const isRead=st.readCountries.has(name);
            tooltipRef.current.style.display="block";
            tooltipRef.current.style.left=(e.clientX-rect.left+14)+"px";
            tooltipRef.current.style.top=(e.clientY-rect.top-10)+"px";
            tooltipRef.current.innerHTML=`<strong>${name}</strong>${isRead?`<br/>${count} book${count>1?"s":""} read`:""}<br/><span style="color:#c8a96e;font-size:11px">click to explore</span>`;
          } else tooltipRef.current.style.display="none";
        }
      }
    }
  }
  function zoomBtn(factor){
    const canvas=canvasRef.current, st=s.current;
    const cx=canvas.width/2, cy=canvas.height/2;
    const newZoom=Math.max(1,Math.min(8,st.zoom*factor));
    const ratio=newZoom/st.zoom;
    st.panX=cx-ratio*(cx-st.panX); st.panY=cy-ratio*(cy-st.panY);
    st.zoom=newZoom; clampPan(); draw();
  }
  function resetView(){ const st=s.current; st.zoom=1; st.panX=0; st.panY=0; draw(); }

  return (
    <div style={{position:"relative",display:"inline-block",borderRadius:10,overflow:"hidden",border:"1px solid #c8bfb0"}}>
      <canvas ref={canvasRef} width={420} height={300}
        style={{display:"block",cursor:"grab"}}
        onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave} onMouseMove={handleMouseMove} onWheel={handleWheel}
      />
      <div style={{position:"absolute",bottom:10,right:10,display:"flex",flexDirection:"column",gap:4}}>
        {[["＋",1.4],["－",1/1.4]].map(([l,f])=>(
          <button key={l} onClick={()=>zoomBtn(f)} style={{width:30,height:30,background:"rgba(250,245,239,0.95)",border:"1px solid #c8bfb0",borderRadius:6,fontSize:17,cursor:"pointer",color:"#3c2a1a",fontWeight:600,lineHeight:1}}>{l}</button>
        ))}
        <button onClick={resetView} style={{width:30,height:30,background:"rgba(250,245,239,0.95)",border:"1px solid #c8bfb0",borderRadius:6,fontSize:11,cursor:"pointer",color:"#7a5c40"}}>⊞</button>
      </div>
      <div ref={tooltipRef} style={{display:"none",position:"absolute",pointerEvents:"none",background:"rgba(30,18,8,0.92)",color:"#f5ecd8",fontSize:13,padding:"6px 10px",borderRadius:6,border:"1px solid #c8a96e",lineHeight:1.5,zIndex:10,whiteSpace:"nowrap"}}/>
    </div>
  );
}

// ─── Country modal — top book of the country + user's rated books there ───────
// "Top book" uses Open Library's place search sorted by readinglog count (the
// closest available proxy for popularity / sales). Falls back gracefully offline.
function CountryModal({ country, logs, onClose, onEdit }) {
  const [topBook,setTopBook]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);

  // the user's own rated books from this country
  const myBooks = logs.filter(l=>l.country===country);

  useEffect(()=>{
    let cancelled=false;
    (async ()=>{
      setLoading(true); setError(null); setTopBook(null);
      try {
        const place = country.toLowerCase().replace(/ /g,"_");
        const fields="key,title,author_name,first_publish_year,cover_i,editions,editions.title,editions.cover_i";
        const url=`https://openlibrary.org/search.json?q=place:${encodeURIComponent(place)}&sort=readinglog&lang=en&fields=${fields}&limit=1`;
        const res=await fetch(url);
        const data=await res.json();
        const d=(data.docs||[])[0];
        if (!cancelled) {
          if (d) {
            const en=d.editions?.docs?.[0];
            setTopBook({ title:en?.title||d.title, author:(d.author_name||[])[0]||"Unknown",
                         year:d.first_publish_year, coverId:en?.cover_i||d.cover_i });
          } else setError("No popular book found for this country.");
        }
      } catch(e) {
        if (!cancelled) setError("Open Library unreachable — can't load the top book here.");
      } finally { if(!cancelled) setLoading(false); }
    })();
    return ()=>{ cancelled=true; };
  }, [country]);

  const continent = COUNTRY_TO_CONTINENT[country];

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{background:"#faf5ef",borderRadius:14,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e0d4c4",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#faf5ef"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <h2 style={{margin:0,fontSize:19,fontFamily:"Georgia,serif",color:"#1e1208"}}>{country}</h2>
            {continent&&<ContinentBadge continent={continent}/>}
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#7a5c40"}}>×</button>
        </div>

        <div style={{padding:24}}>
          {/* Top book */}
          <p style={{margin:"0 0 10px",fontSize:13,fontWeight:600,color:"#5a3e2b",textTransform:"uppercase",letterSpacing:"0.04em"}}>Most popular book</p>
          {loading&&<p style={{color:"#9a7c60",fontSize:14}}>Loading from Open Library…</p>}
          {error&&!loading&&<p style={{color:"#b0856a",fontSize:14}}>{error}</p>}
          {topBook&&!loading&&(
            <div style={{display:"flex",gap:14,alignItems:"flex-start",padding:"14px",background:"#fff",border:"1px solid #e0d4c4",borderRadius:10}}>
              <BookCover coverId={topBook.coverId} title={topBook.title} size={64}/>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:16,fontWeight:700,color:"#1e1208",fontFamily:"Georgia,serif"}}>{topBook.title}</p>
                <p style={{margin:"4px 0 0",fontSize:14,color:"#7a5c40"}}>{topBook.author}{topBook.year?` · ${topBook.year}`:""}</p>
                <p style={{margin:"8px 0 0",fontSize:11,color:"#b09070"}}>★ Most-read on Open Library</p>
              </div>
            </div>
          )}

          {/* User's rated books from this country */}
          <p style={{margin:"24px 0 10px",fontSize:13,fontWeight:600,color:"#5a3e2b",textTransform:"uppercase",letterSpacing:"0.04em"}}>
            Your books from {country} {myBooks.length>0&&`(${myBooks.length})`}
          </p>
          {myBooks.length>0&&(
            <p style={{margin:"-4px 0 10px",fontSize:12,color:"#b09070"}}>Click a book to read your review</p>
          )}
          {myBooks.length===0&&(
            <p style={{color:"#9a7c60",fontSize:14}}>You haven't rated any books from {country} yet.</p>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {myBooks.map(l=><CountryBookRow key={l.id} log={l} onEdit={onEdit}/>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// One expandable row in the country modal: click to reveal the full review.
function CountryBookRow({ log, onEdit }) {
  const [open,setOpen]=useState(false);
  return (
    <div style={{background:"#fff",border:"1px solid #e0d4c4",borderRadius:8,overflow:"hidden"}}>
      <div onClick={()=>setOpen(!open)}
        style={{display:"flex",gap:12,alignItems:"center",padding:"10px 12px",cursor:"pointer"}}>
        <BookCover coverId={log.coverId} title={log.title} size={40}/>
        <div style={{flex:1,minWidth:0}}>
          <p style={{margin:0,fontSize:14,fontWeight:600,color:"#1e1208",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{log.title}</p>
          <p style={{margin:"2px 0 0",fontSize:12,color:"#7a5c40"}}>{log.author}</p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
          <StarRating value={log.rating} readOnly size={14}/>
          <span style={{fontSize:13,color:"#9a7c60"}}>{log.rating}</span>
        </div>
        <span style={{flexShrink:0,color:"#b09070",fontSize:12,transform:open?"rotate(180deg)":"none",transition:"transform 0.2s"}}>▾</span>
      </div>
      {open&&(
        <div style={{padding:"0 12px 12px 64px",borderTop:"1px solid #f0e8db"}}>
          {log.tags&&log.tags.length>0&&(
            <div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"10px 0 0"}}>
              {log.tags.map(t=><Tag key={t} label={t}/>)}
            </div>
          )}
          {log.comment
            ? <p style={{margin:"10px 0 0",fontSize:14,color:"#3c2a1a",lineHeight:1.65,whiteSpace:"pre-wrap"}}>{log.comment}</p>
            : <p style={{margin:"10px 0 0",fontSize:13,color:"#9a7c60",fontStyle:"italic"}}>No written review.</p>}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:10}}>
            <p style={{margin:0,fontSize:11,color:"#b09070"}}>Logged {log.date}</p>
            {onEdit&&(
              <button onClick={()=>onEdit(log)}
                style={{background:"none",border:"1px solid #d0c0a8",borderRadius:6,color:"#7a5c40",fontSize:12,padding:"4px 12px",cursor:"pointer",fontFamily:"Georgia,serif"}}>
                Edit review
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Virtual Bookshelf ────────────────────────────────────────────────────────
// Inspired by the Criterion Closet: logged books become spines on wooden shelves;
// click a spine to pull the book and read its cover, rating and review.
// Spine hue = continent (the shelf doubles as a reading map); lightness varies per title.
const SPINE_HUES = {Africa:[28,48],Americas:[160,38],Asia:[225,42],Europe:[318,36],Oceania:[182,38]};  // [hue,sat]

// Large cover on the left, the reader's review + an Open Library summary on the
// right. Designed to double as the "book page" when visiting someone else's
// library in the future.
function BookDetailPanel({ log, onClose, onEdit }) {
  const [summary,setSummary]=useState(null);
  const [summaryState,setSummaryState]=useState("loading");   // loading | ok | none

  useEffect(()=>{
    let cancelled=false;
    (async ()=>{
      setSummary(null); setSummaryState("loading");
      try {
        // logs store either "OL16805415W" or "/works/OL16805415W"
        const key = log.bookId?.startsWith("/") ? log.bookId : `/works/${log.bookId}`;
        const res = await fetch(`https://openlibrary.org${key}.json`);
        if (!res.ok) throw new Error("no work");
        const work = await res.json();
        const d = work.description;
        const text = typeof d === "string" ? d : d?.value;
        if (!cancelled) {
          if (text) { setSummary(text.trim()); setSummaryState("ok"); }
          else setSummaryState("none");
        }
      } catch { if (!cancelled) setSummaryState("none"); }
    })();
    return ()=>{ cancelled=true; };
  }, [log.bookId]);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(20,12,6,0.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{background:"#faf5ef",borderRadius:14,width:"100%",maxWidth:760,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",gap:28,padding:28,flexWrap:"wrap"}}>
          {/* Big cover, side by side with everything else */}
          <div style={{flex:"0 0 auto",margin:"0 auto"}}>
            <BookCover coverId={log.coverId} title={log.title} size={190}/>
          </div>

          <div style={{flex:1,minWidth:260}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
              <h2 style={{margin:"0 0 4px",fontSize:24,fontFamily:"Georgia,serif",color:"#1e1208",lineHeight:1.25}}>{log.title}</h2>
              <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#7a5c40",lineHeight:1}}>×</button>
            </div>
            <p style={{margin:"0 0 12px",fontSize:15,color:"#7a5c40"}}>{log.author}{log.year?` · ${log.year}`:""}</p>

            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <StarRating value={log.rating} readOnly size={20}/>
              <span style={{fontSize:16,color:"#9a7c60",fontWeight:600}}>{log.rating}</span>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
              {log.continent&&<ContinentBadge continent={log.continent}/>}
              {log.country&&<span style={{fontSize:12,color:"#7a5c40",background:"#f5f0ea",padding:"2px 7px",borderRadius:10,border:"1px solid #e0d4c4"}}>📍 {log.country}</span>}
              {log.tags&&log.tags.map(t=><Tag key={t} label={t}/>)}
            </div>

            <p style={{margin:"0 0 6px",fontSize:12,fontWeight:600,color:"#5a3e2b",textTransform:"uppercase",letterSpacing:"0.05em"}}>My review</p>
            {log.comment
              ? <p style={{margin:0,fontSize:14,color:"#3c2a1a",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{log.comment}</p>
              : <p style={{margin:0,fontSize:14,color:"#9a7c60",fontStyle:"italic"}}>No written review.</p>}

            <p style={{margin:"18px 0 6px",fontSize:12,fontWeight:600,color:"#5a3e2b",textTransform:"uppercase",letterSpacing:"0.05em"}}>About this book</p>
            {summaryState==="loading"&&<p style={{margin:0,fontSize:13,color:"#9a7c60"}}>Loading summary from Open Library…</p>}
            {summaryState==="none"&&<p style={{margin:0,fontSize:13,color:"#9a7c60",fontStyle:"italic"}}>No summary available on Open Library.</p>}
            {summaryState==="ok"&&<p style={{margin:0,fontSize:14,color:"#4a3728",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{summary}</p>}

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:20}}>
              <p style={{margin:0,fontSize:11,color:"#b09070"}}>Logged {log.date}</p>
              <div style={{display:"flex",gap:8}}>
                {onEdit&&<button onClick={()=>onEdit(log)} style={{background:"none",border:"1px solid #d0c0a8",borderRadius:6,color:"#7a5c40",fontSize:13,padding:"7px 14px",cursor:"pointer",fontFamily:"Georgia,serif"}}>Edit review</button>}
                <button onClick={onClose} style={{background:"#c8802a",border:"none",borderRadius:6,color:"#fff",fontSize:13,padding:"7px 16px",cursor:"pointer",fontFamily:"Georgia,serif"}}>Close</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const WOOD_TINTS = ["#a97e4c","#8a5a33","#b98d5a","#6e4a2e","#5d6b5a","#4a5a6e"];

// Editor for creating / customising a shelf: name, wood colour, and (for custom
// shelves) hand-picking which logged books sit on it.
function ShelfEditor({ mode, shelf, logs, onClose, onCreate, onUpdate, onDelete, onSetBooks }) {
  const isNew = mode==="new";
  const [name,setName]=useState(isNew?"":shelf.name);
  const [color,setColor]=useState(isNew?WOOD_TINTS[0]:(shelf.color||WOOD_TINTS[0]));
  const [picked,setPicked]=useState(new Set(isNew?[]:shelf.bookIds));
  const [busy,setBusy]=useState(false);
  const isDefault = !isNew && shelf.isDefault;

  async function save() {
    const n=name.trim();
    if (!n) return;
    setBusy(true);
    try {
      if (isNew) {
        const created = await onCreate(n, color);
        if (created && picked.size) await onSetBooks(created.id, [...picked]);
      } else {
        await onUpdate(shelf.id, { name:n, color });
        if (!isDefault) await onSetBooks(shelf.id, [...picked]);
      }
      onClose();
    } finally { setBusy(false); }
  }

  function toggle(bookId) {
    setPicked(prev=>{ const s=new Set(prev); s.has(bookId)?s.delete(bookId):s.add(bookId); return s; });
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(20,12,6,0.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{background:"#faf5ef",borderRadius:14,width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e0d4c4",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:18,fontFamily:"Georgia,serif",color:"#1e1208"}}>{isNew?"New shelf":"Customise shelf"}</h2>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#7a5c40"}}>×</button>
        </div>
        <div style={{padding:24}}>
          <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Shelf name</label>
          <input value={name} onChange={e=>setName(e.target.value)} maxLength={60} placeholder="e.g. Favourites, To lend, 2026 reads…"
            style={{width:"100%",padding:"10px 12px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:14,fontFamily:"Georgia,serif",background:"#fff",boxSizing:"border-box",outline:"none",marginBottom:18}}/>

          <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Wood colour</label>
          <div style={{display:"flex",gap:8,marginBottom:18}}>
            {WOOD_TINTS.map(c=>(
              <button key={c} onClick={()=>setColor(c)} title={c}
                style={{width:34,height:34,borderRadius:8,background:c,cursor:"pointer",
                  border:color===c?"3px solid #c8802a":"2px solid #e0d4c4"}}/>
            ))}
          </div>

          {isDefault ? (
            <p style={{margin:"0 0 18px",fontSize:13,color:"#9a7c60",background:"#fdf6ee",border:"1px solid #e8dfd3",borderRadius:8,padding:"10px 12px"}}>
              📚 This shelf always contains every book you've read — it fills itself.
            </p>
          ) : (
            <>
              <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>
                Books on this shelf <span style={{fontWeight:400,color:"#9a7c60"}}>({picked.size} selected)</span>
              </label>
              {logs.length===0&&<p style={{fontSize:13,color:"#9a7c60"}}>Log books first — then place them here.</p>}
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:230,overflowY:"auto",marginBottom:18}}>
                {logs.map(l=>(
                  <label key={l.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",background:"#fff",border:`1px solid ${picked.has(l.bookId)?"#c8802a":"#e0d4c4"}`,borderRadius:8,cursor:"pointer"}}>
                    <input type="checkbox" checked={picked.has(l.bookId)} onChange={()=>toggle(l.bookId)} style={{accentColor:"#c8802a"}}/>
                    <BookCover coverId={l.coverId} title={l.title} size={26}/>
                    <span style={{fontSize:13,color:"#1e1208",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.title}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {!isNew&&!isDefault&&(
              <button onClick={()=>{ if(window.confirm(`Delete shelf "${shelf.name}"? The books stay in your log.`)) { onDelete(shelf.id); onClose(); } }}
                style={{padding:"10px 14px",background:"none",border:"1px solid #c99",color:"#a33",borderRadius:8,fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                Delete
              </button>
            )}
            <div style={{flex:1}}/>
            <button onClick={onClose} style={{padding:"10px 16px",background:"none",border:"1px solid #d0c0a8",color:"#5a3e2b",borderRadius:8,fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancel</button>
            <button onClick={save} disabled={busy||!name.trim()}
              style={{padding:"10px 20px",background:"#c8802a",border:"none",color:"#fff",borderRadius:8,fontSize:13,fontWeight:600,cursor:busy?"wait":"pointer",fontFamily:"Georgia,serif",opacity:(busy||!name.trim())?0.6:1}}>
              {isNew?"Create shelf":"Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bookshelf({ logs, shelves=[], onCreateShelf, onUpdateShelf, onDeleteShelf, onSetShelfBooks, onEditLog, readOnly=false, title="My bookshelves" }) {
  const [selected,setSelected]=useState(null);
  const [sortBy,setSortBy]=useState("recent");
  const [webglError,setWebglError]=useState(false);
  const [activeId,setActiveId]=useState(shelves[0]?.id);
  const [editor,setEditor]=useState(null);        // null | "new" | "edit"
  const mountRef=useRef(null);
  const S=useRef(null);   // three.js scene state (renderer, meshes, targets...)

  const active = shelves.find(s=>s.id===activeId) || shelves[0];
  useEffect(()=>{ if (!shelves.find(s=>s.id===activeId)) setActiveId(shelves[0]?.id); },[shelves]);   // eslint-disable-line

  // default shelf = every logged book; custom shelves = hand-picked
  const shelfLogs = (!active||active.isDefault) ? logs : logs.filter(l=>active.bookIds.includes(l.bookId));
  const woodColor = active?.color || "#a97e4c";

  const sorted = [...shelfLogs].sort((a,b)=>{
    if (sortBy==="title")     return a.title.localeCompare(b.title);
    if (sortBy==="rating")    return b.rating-a.rating;
    if (sortBy==="author")    return (a.author||"").localeCompare(b.author||"");
    if (sortBy==="continent") return (a.continent||"zz").localeCompare(b.continent||"zz");
    return (b.date||"").localeCompare(a.date||"");
  });

  // ── procedural textures ──────────────────────────────────────────────
  function hashOf(str){ let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))>>>0; return h; }
  function hueOf(log){ return SPINE_HUES[log.continent]||[30,14]; }

  function spineTexture(log){
    const [hue,sat]=hueOf(log);
    const h=hashOf(log.bookId||log.title); const light=26+(h%16);
    const c=document.createElement("canvas"); c.width=128; c.height=512;
    const x=c.getContext("2d");
    x.fillStyle=`hsl(${hue},${sat}%,${light}%)`; x.fillRect(0,0,128,512);
    // side shading for depth
    const g=x.createLinearGradient(0,0,128,0);
    g.addColorStop(0,"rgba(255,255,255,0.10)"); g.addColorStop(0.5,"rgba(0,0,0,0)"); g.addColorStop(1,"rgba(0,0,0,0.25)");
    x.fillStyle=g; x.fillRect(0,0,128,512);
    const accent=`hsl(${hue},${Math.min(sat+15,60)}%,${Math.min(light+38,80)}%)`;
    x.fillStyle=accent; x.fillRect(20,26,88,5); x.fillRect(20,481,88,5);
    if (log.rating>=4){ x.fillStyle="#f0c040"; x.beginPath(); x.arc(64,52,7,0,Math.PI*2); x.fill(); }
    x.save(); x.translate(64,266); x.rotate(Math.PI/2);
    x.fillStyle=accent; x.font="600 34px Georgia,serif"; x.textAlign="center"; x.textBaseline="middle";
    let t=log.title; while (x.measureText(t).width>380 && t.length>3) t=t.slice(0,-2);
    if (t!==log.title) t+="…";
    x.fillText(t,0,0); x.restore();
    const tex=new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace!==undefined) tex.colorSpace=THREE.SRGBColorSpace;
    return tex;
  }

  function coverFallbackTexture(log){
    const [hue,sat]=hueOf(log);
    const h=hashOf(log.bookId||log.title); const light=22+(h%12);
    const c=document.createElement("canvas"); c.width=512; c.height=768;
    const x=c.getContext("2d");
    x.fillStyle=`hsl(${hue},${sat}%,${light}%)`; x.fillRect(0,0,512,768);
    x.strokeStyle=`hsl(${hue},${Math.min(sat+15,60)}%,${Math.min(light+40,82)}%)`;
    x.lineWidth=6; x.strokeRect(28,28,456,712);
    x.fillStyle=`hsl(${hue},${Math.min(sat+10,55)}%,${Math.min(light+48,88)}%)`;
    x.font="700 44px Georgia,serif"; x.textAlign="center";
    const words=(log.title||"?").split(" "); let line="",y=210;
    for (const w of words){
      if (x.measureText(line+" "+w).width>420){ x.fillText(line.trim(),256,y); line=w; y+=56; if(y>560)break; }
      else line+=" "+w;
    }
    if (y<=560) x.fillText(line.trim(),256,y);
    x.font="italic 30px Georgia,serif"; x.fillText(log.author||"",256,660);
    const tex=new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace!==undefined) tex.colorSpace=THREE.SRGBColorSpace;
    return tex;
  }

  // ── scene bootstrap (once) ────────────────────────────────────────
  useEffect(()=>{
    const mount=mountRef.current;
    if (!mount) return;
    let renderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true}); }
    catch(e){ setWebglError(true); return; }

    const W=mount.clientWidth||860, H=520;
    renderer.setSize(W,H);
    renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
    mount.appendChild(renderer.domElement);

    const scene=new THREE.Scene();
    scene.background=new THREE.Color("#5c452e");
    scene.fog=new THREE.Fog("#5c452e",10,22);

    const camera=new THREE.PerspectiveCamera(45,W/H,0.1,60);
    camera.position.set(0,2.0,8.2);

    // warm, bright library lighting
    scene.add(new THREE.AmbientLight(0xfff0dc,1.0));
    const spot=new THREE.SpotLight(0xffd9a8,1.5,30,Math.PI/3.2,0.4);
    spot.position.set(0,7.5,7); scene.add(spot); scene.add(spot.target);
    const fill=new THREE.PointLight(0xffc890,0.6,20); fill.position.set(-4,2.5,4); scene.add(fill);

    // room: back wall + floor + side panels
    const wallMat=new THREE.MeshStandardMaterial({color:"#8a6a48",roughness:0.95});
    const back=new THREE.Mesh(new THREE.PlaneGeometry(26,14),wallMat); back.position.set(0,3.5,-1.35); scene.add(back);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(26,20),new THREE.MeshStandardMaterial({color:"#6e5236",roughness:1}));
    floor.rotation.x=-Math.PI/2; floor.position.y=-1.6; scene.add(floor);
    for (const sx of [-5.4,5.4]) {
      const side=new THREE.Mesh(new THREE.BoxGeometry(0.35,11,2.6),new THREE.MeshStandardMaterial({color:"#96703f",roughness:0.9}));
      side.position.set(sx,2.6,-0.1); scene.add(side);
    }

    S.current={ renderer, scene, camera, mount,
      books:new Map(), boards:[], raycaster:new THREE.Raycaster(),
      mouse:new THREE.Vector2(-10,-10), parallax:{x:0,y:0},
      hoverId:null, selectedId:null, raf:null, t:0 };

    // ── interactions ──
    const el=renderer.domElement;
    el.style.cursor="default";
    const toNDC=(e)=>{
      const r=el.getBoundingClientRect();
      S.current.mouse.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
      S.current.parallax={x:S.current.mouse.x, y:S.current.mouse.y};
    };
    const pick=()=>{
      const st=S.current;
      st.raycaster.setFromCamera(st.mouse,st.camera);
      const hit=st.raycaster.intersectObjects([...st.books.values()],false)[0];
      return hit?hit.object:null;
    };
    const onMove=(e)=>{ toNDC(e);
      const m=pick(); const st=S.current;
      const id=m?m.userData.log.id:null;
      if (id!==st.hoverId){ st.hoverId=id; el.style.cursor=id?"pointer":"default"; }
    };
    const onClick=(e)=>{ toNDC(e);
      const m=pick(); if(!m) return;
      selectBook(m.userData.log);
    };
    const onWheel=(e)=>{ e.preventDefault();
      const c=S.current.camera;
      c.position.z=Math.max(4.6,Math.min(11,c.position.z+(e.deltaY>0?0.5:-0.5)));
    };
    el.addEventListener("mousemove",onMove);
    el.addEventListener("click",onClick);
    el.addEventListener("wheel",onWheel,{passive:false});

    const onResize=()=>{
      const w=mount.clientWidth||W;
      camera.aspect=w/H; camera.updateProjectionMatrix(); renderer.setSize(w,H);
    };
    window.addEventListener("resize",onResize);

    // ── render loop: lerp to targets, idle sway ──
    const loop=()=>{
      const st=S.current; if(!st) return;
      st.t+=0.016;
      for (const mesh of st.books.values()){
        const tgt=mesh.userData.target;
        mesh.position.lerp(tgt.pos,0.12);
        mesh.rotation.y+=(tgt.rotY-mesh.rotation.y)*0.12;
        const lift=(st.hoverId===mesh.userData.log.id && st.selectedId!==mesh.userData.log.id)?0.12:0;
        mesh.position.y+=((tgt.pos.y+lift)-mesh.position.y)*0.2;
      }
      // parallax + gentle idle sway = the "alive" part
      const p=st.parallax;
      st.camera.position.x+=((p.x*0.9+Math.sin(st.t*0.4)*0.06)-st.camera.position.x)*0.05;
      st.camera.position.y+=((2.0+p.y*0.45+Math.cos(st.t*0.3)*0.04)-st.camera.position.y)*0.05;
      st.camera.lookAt(0,1.9,0);
      st.renderer.render(st.scene,st.camera);
      st.raf=requestAnimationFrame(loop);
    };
    loop();

    return ()=>{
      const st=S.current;
      cancelAnimationFrame(st.raf);
      el.removeEventListener("mousemove",onMove);
      el.removeEventListener("click",onClick);
      el.removeEventListener("wheel",onWheel);
      window.removeEventListener("resize",onResize);
      st.renderer.dispose();
      if (st.renderer.domElement.parentNode) st.renderer.domElement.parentNode.removeChild(st.renderer.domElement);
      S.current=null;
    };
  },[]);

  // ── book meshes: sync with logs + sort, then layout targets ──────────────
  useEffect(()=>{
    const st=S.current; if(!st) return;

    // create missing meshes
    for (const log of shelfLogs){
      if (st.books.has(log.id)) continue;
      const h=hashOf(log.bookId||log.title);
      const height=1.45+(h%46)/100, thick=0.26+(h%15)/100, depth=1.02;
      const pages=new THREE.MeshStandardMaterial({color:"#e6d9c2",roughness:0.9});
      const dark =new THREE.MeshStandardMaterial({color:"#241609",roughness:0.9});
      const coverMat=new THREE.MeshStandardMaterial({map:coverFallbackTexture(log),roughness:0.6});
      const spineMat=new THREE.MeshStandardMaterial({map:spineTexture(log),roughness:0.62});
      // order: +x(front cover) -x(back) +y -y +z(spine) -z
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(thick,height,depth),
        [coverMat,dark,pages,dark,spineMat,dark]);
      mesh.userData={log, target:{pos:new THREE.Vector3(0,0,0), rotY:0}, height};
      st.scene.add(mesh);
      st.books.set(log.id,mesh);
      // try real Open Library cover (CORS permitting); fallback stays otherwise
      if (log.coverId){
        const loader=new THREE.TextureLoader(); loader.setCrossOrigin("anonymous");
        loader.load(`https://covers.openlibrary.org/b/id/${log.coverId}-L.jpg`,
          tex=>{ if (THREE.SRGBColorSpace!==undefined) tex.colorSpace=THREE.SRGBColorSpace;
                 coverMat.map=tex; coverMat.needsUpdate=true; },
          undefined, ()=>{});
      }
    }
    // remove books that left this shelf (or were deleted)
    for (const [id,mesh] of st.books){
      if (!shelfLogs.find(l=>l.id===id)){ st.scene.remove(mesh); st.books.delete(id); }
    }

    // layout: rows of accumulated spine thickness, centred
    const ROW_W=8.6, ROW_Y0=3.1, ROW_DY=2.35;
    const rows=[]; let row=[], acc=0;
    for (const log of sorted){
      const mesh=st.books.get(log.id); if(!mesh) continue;
      const w=mesh.geometry.parameters.width+0.06;
      if (acc+w>ROW_W && row.length){ rows.push(row); row=[]; acc=0; }
      row.push(mesh); acc+=w;
    }
    if (row.length) rows.push(row);

    rows.forEach((r,ri)=>{
      const total=r.reduce((s,m)=>s+m.geometry.parameters.width+0.06,0);
      let cx=-total/2;
      const boardY=ROW_Y0-ri*ROW_DY;
      for (const mesh of r){
        const w=mesh.geometry.parameters.width;
        const keepOut = st.selectedId===mesh.userData.log.id;
        mesh.userData.target.pos.set(cx+w/2, boardY+mesh.userData.height/2+0.06, keepOut?2.6:0);
        mesh.userData.target.rotY = keepOut?-Math.PI/2:0;
        cx+=w+0.06;
      }
    });

    // shelf boards to match row count
    for (const b of st.boards) st.scene.remove(b);
    st.boards=rows.map((_,ri)=>{
      const b=new THREE.Mesh(new THREE.BoxGeometry(10.4,0.14,1.5),
        new THREE.MeshStandardMaterial({color:woodColor,roughness:0.75}));
      b.position.set(0,ROW_Y0-ri*ROW_DY,0);
      st.scene.add(b); return b;
    });
  },[logs,sortBy,activeId,shelves]);   // re-layout on book/sort/shelf change (books glide to new slots)

  // ── select / put back ──
  function selectBook(log){
    const st=S.current; if(!st) return;
    if (st.selectedId===log.id){ putBack(); return; }
    putBack();                       // return any previously pulled book
    st.selectedId=log.id;
    const mesh=st.books.get(log.id);
    if (mesh){ mesh.userData.target.pos.z=2.6; mesh.userData.target.rotY=-Math.PI/2; }
    setTimeout(()=>setSelected(log),420);   // let the pull animation play first
  }
  function putBack(){
    const st=S.current; if(!st||!st.selectedId) return;
    const mesh=st.books.get(st.selectedId);
    if (mesh){ mesh.userData.target.pos.z=0; mesh.userData.target.rotY=0; }
    st.selectedId=null;
  }

  return (
    <div>
      {selected&&<BookDetailPanel log={selected}
        onClose={()=>{ setSelected(null); putBack(); }}
        onEdit={onEditLog?(l)=>{ setSelected(null); putBack(); onEditLog(l); }:null}/>}

      {editor&&(
        <ShelfEditor mode={editor} shelf={active} logs={logs}
          onClose={()=>setEditor(null)}
          onCreate={async (n,c)=>{ const s=await onCreateShelf(n,c); if(s) setActiveId(s.id); return s; }}
          onUpdate={onUpdateShelf} onDelete={onDeleteShelf} onSetBooks={onSetShelfBooks}/>
      )}

      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:12}}>
        <h2 style={{margin:0,fontSize:22,fontFamily:"Georgia,serif",color:"#1e1208"}}>{title}</h2>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={{fontSize:13,color:"#9a7c60"}}>{shelfLogs.length} book{shelfLogs.length!==1?"s":""} · Sort</span>
          {[["recent","Recent"],["title","Title"],["author","Author"],["rating","Rating"],["continent","Continent"]].map(([v,label])=>(
            <button key={v} onClick={()=>setSortBy(v)}
              style={{padding:"4px 10px",borderRadius:14,border:`1px solid ${sortBy===v?"#c8802a":"#d0c0a8"}`,background:sortBy===v?"#c8802a":"transparent",color:sortBy===v?"#fff":"#7a5c40",fontSize:12,cursor:"pointer",fontFamily:"Georgia,serif"}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Shelf tabs: default (all read books) + up to 2 custom shelves */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {shelves.map(s=>{
          const isActive=active&&s.id===active.id;
          const count=s.isDefault?logs.length:s.bookIds.length;
          return (
            <button key={s.id} onClick={()=>setActiveId(s.id)}
              style={{display:"inline-flex",alignItems:"center",gap:7,padding:"7px 14px",borderRadius:8,cursor:"pointer",fontFamily:"Georgia,serif",fontSize:13,
                border:`1px solid ${isActive?"#c8802a":"#d0c0a8"}`,background:isActive?"#faeeda":"#fff",color:isActive?"#8B4513":"#7a5c40",fontWeight:isActive?600:400}}>
              <span style={{width:10,height:10,borderRadius:3,background:s.color||"#a97e4c",border:"1px solid rgba(0,0,0,0.15)"}}/>
              {s.isDefault?"📚 ":""}{s.name}
              <span style={{fontSize:11,color:"#b09070"}}>({count})</span>
            </button>
          );
        })}
        {!readOnly&&shelves.length<3&&(
          <button onClick={()=>setEditor("new")}
            style={{padding:"7px 14px",borderRadius:8,border:"1px dashed #c0a880",background:"#faf0e4",color:"#7a5c40",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            + New shelf
          </button>
        )}
        {!readOnly&&active&&(
          <button onClick={()=>setEditor("edit")}
            style={{padding:"7px 14px",borderRadius:8,border:"1px solid #d0c0a8",background:"none",color:"#7a5c40",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>
            ✎ Customise
          </button>
        )}
      </div>

      {webglError&&(
        <p style={{color:"#c0392b",textAlign:"center",padding:"40px 0"}}>WebGL is unavailable in this browser — the 3D shelf can't render here.</p>
      )}

      <div ref={mountRef} style={{width:"100%",borderRadius:14,overflow:"hidden",border:"1px solid #b89468",minHeight:520,background:"#5c452e"}}/>

      {shelfLogs.length===0&&!webglError&&(
        <p style={{color:"#9a7c60",textAlign:"center",margin:"14px 0 0"}}>
          {readOnly
            ? <>This shelf is empty.</>
            : active&&!active.isDefault
              ? <>This shelf is empty — click <b>✎ Customise</b> to place some of your books on it.</>
              : <>Your shelves are empty — log a book to place it in the closet.</>}
        </p>
      )}

      <div style={{display:"flex",gap:14,marginTop:12,flexWrap:"wrap",justifyContent:"center"}}>
        {CONTINENTS.map(c=>{
          const [hue,sat]=SPINE_HUES[c];
          return (
            <div key={c} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#9a7c60"}}>
              <div style={{width:9,height:13,background:`hsl(${hue},${sat}%,33%)`,borderRadius:1}}/> {c}
            </div>
          );
        })}
      </div>
      <p style={{margin:"8px 0 0",fontSize:12,color:"#9a7c60",textAlign:"center"}}>
        Move the mouse to look around · scroll to step closer · click a spine to pull the book out · spine colour = continent
      </p>
    </div>
  );
}

// ─── Globe View ───────────────────────────────────────────────────────────────
function GlobeView({ logs, onEditLog }) {
  const [modalCountry,setModalCountry]=useState(null);
  const readCountries=[...new Set(logs.map(l=>l.country).filter(Boolean))];
  const byContinent={};
  logs.forEach(l=>{ if(l.continent) byContinent[l.continent]=(byContinent[l.continent]||0)+1; });

  return (
    <div>
      {modalCountry&&<CountryModal country={modalCountry} logs={logs} onClose={()=>setModalCountry(null)}
        onEdit={onEditLog?(log)=>{ setModalCountry(null); onEditLog(log); }:null}/>}
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:20}}>
        <h2 style={{margin:0,fontSize:22,fontFamily:"Georgia,serif",color:"#1e1208"}}>Reading map</h2>
        <span style={{fontSize:13,color:"#9a7c60"}}>{readCountries.length} {readCountries.length===1?"country":"countries"} explored</span>
      </div>

      <div style={{display:"flex",gap:28,alignItems:"flex-start",flexWrap:"wrap"}}>
        {/* Globe */}
        <div style={{flex:"0 0 auto"}}>
          <ReadingGlobe logs={logs} onCountryClick={setModalCountry}/>
          <p style={{margin:"8px 0 0",fontSize:12,color:"#9a7c60",textAlign:"center"}}>Click a country to explore · drag to pan · scroll to zoom</p>
          <div style={{display:"flex",gap:14,marginTop:8,justifyContent:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#7a5c40"}}>
              <div style={{width:12,height:12,borderRadius:2,background:"#C8802A"}}/> Read
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#7a5c40"}}>
              <div style={{width:12,height:12,borderRadius:2,background:"#fff",border:"1px solid #9a8878"}}/> Not yet
            </div>
          </div>
        </div>

        {/* Stats sidebar */}
        <div style={{flex:1,minWidth:220}}>
          <p style={{margin:"0 0 12px",fontSize:14,fontWeight:600,color:"#5a3e2b"}}>Countries explored</p>
          {readCountries.length===0&&(
            <p style={{color:"#9a7c60",fontSize:14}}>Log books to start colouring the map.</p>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:20}}>
            {readCountries.map(country=>{
              const count=logs.filter(l=>l.country===country).length;
              const continent=COUNTRY_TO_CONTINENT[country]||"Unknown";
              return (
                <div key={country} onClick={()=>setModalCountry(country)}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",background:"#fff",border:"1px solid #e0d4c4",borderRadius:8,cursor:"pointer"}}
                  onMouseOver={e=>e.currentTarget.style.background="#f7f1e7"}
                  onMouseOut={e=>e.currentTarget.style.background="#fff"}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:"#C8802A",flexShrink:0}}/>
                    <span style={{fontSize:14,color:"#1e1208"}}>{country}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <ContinentBadge continent={continent}/>
                    <span style={{fontSize:12,color:"#9a7c60"}}>{count} book{count>1?"s":""}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {Object.keys(byContinent).length>0&&(
            <>
              <p style={{margin:"0 0 10px",fontSize:14,fontWeight:600,color:"#5a3e2b"}}>By continent</p>
              {CONTINENTS.map(c=>{
                const n=byContinent[c]||0;
                const max=Math.max(...Object.values(byContinent),1);
                return (
                  <div key={c} style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:3}}>
                      <span style={{color:"#4a3728"}}>{c}</span>
                      <span style={{color:"#9a7c60"}}>{n} book{n!==1?"s":""}</span>
                    </div>
                    <div style={{height:5,background:"#e8dfd3",borderRadius:3}}>
                      <div style={{height:"100%",width:`${n/max*100}%`,background:"#C8802A",borderRadius:3,transition:"width 0.4s"}}/>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Open Library search hook ─────────────────────────────────────────────────
// Falls back to a built-in demo catalogue when the network is unreachable —
// e.g. in the Claude.ai artifact preview, whose sandbox blocks external requests.
// In a real deployment (Vite/CRA/production) the live API is always used.
const DEMO_CATALOGUE = [
  { key:"/works/OL66554W",   title:"Pride and Prejudice",        author_name:["Jane Austen"],               first_publish_year:1813, cover_i:14348537, subject_places:["England"],
    _demo_people:["Elizabeth Bennet","Fitzwilliam Darcy","Jane Bennet","Charles Bingley","Lydia Bennet","George Wickham"] },
  { key:"/works/OL16805415W",   title:"Americanah",                 author_name:["Chimamanda Ngozi Adichie"],  first_publish_year:2013, cover_i:8474037,  subject_places:["Nigeria"],
    _demo_people:["Ifemelu","Obinze","Aunty Uju","Dike"] },
  { key:"/works/OL17762217W",title:"Pachinko",                   author_name:["Min Jin Lee"],               first_publish_year:2017, cover_i:8044605,  subject_places:["Korea"],
    _demo_people:["Sunja","Isak","Noa","Mozasu"] },
  { key:"/works/OL20150260W",title:"Normal People",              author_name:["Sally Rooney"],              first_publish_year:2018, cover_i:8794265,  subject_places:["Ireland"],
    _demo_people:["Marianne","Connell","Lorraine","Jamie"] },
  { key:"/works/OL27448W",   title:"The Lord of the Rings",      author_name:["J.R.R. Tolkien"],            first_publish_year:1954, cover_i:9255566,  subject_places:["England"],
    _demo_people:["Frodo Baggins","Samwise Gamgee","Gandalf","Aragorn","Legolas","Gollum"] },
  { key:"/works/OL15358691W",title:"Half of a Yellow Sun",       author_name:["Chimamanda Ngozi Adichie"],  first_publish_year:2006, cover_i:8239996,  subject_places:["Nigeria"],
    _demo_people:["Ugwu","Olanna","Richard","Kainene"] },
  { key:"/works/OL15331316W",title:"One Hundred Years of Solitude", author_name:["Gabriel García Márquez"], first_publish_year:1967, cover_i:8701238,  subject_places:["Colombia"],
    _demo_people:["José Arcadio Buendía","Úrsula Iguarán","Aureliano Buendía","Remedios"] },
  { key:"/works/OL46913W",   title:"Norwegian Wood",             author_name:["Haruki Murakami"],           first_publish_year:1987, cover_i:11153537, subject_places:["Japan"],
    _demo_people:["Toru Watanabe","Naoko","Midori","Reiko"] },
];

function useOpenLibrarySearch() {
  const [results,setResults]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [offline,setOffline]=useState(false);
  const search=useCallback(debounce(async q=>{
    if (!q||q.length<2){setResults([]);return;}
    setLoading(true);setError(null);
    try {
      // lang=en + editions fields: Open Library returns, for each work, the best
      // matching ENGLISH edition in doc.editions.docs[0]. We prefer its title over
      // the raw work title (which may be in the original language, e.g. Russian).
      const fields="key,title,author_name,first_publish_year,cover_i,edition_count,subject_places,subject,place,language,editions,editions.title,editions.cover_i";
      const res=await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=${fields}&lang=en&limit=12`);
      const data=await res.json();
      const docs=(data.docs||[]).map(d=>{
        const en = d.editions?.docs?.[0];           // best English edition, if any
        return {
          ...d,
          title:   en?.title   || d.title,           // English title when it exists
          cover_i: en?.cover_i || d.cover_i,         // matching English cover too
        };
      });
      // Open Library has duplicate work records for popular books (abridged
      // versions, audio releases, unmerged duplicates). Collapse results that
      // share the same author + normalised title, keeping the record with the
      // most editions — that's almost always the canonical/original work.
      const byKey=new Map();
      for (const d of docs){
        const k=(((d.author_name||[])[0]||"")+"|"+(d.title||"")).toLowerCase()
          .replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim();
        const prev=byKey.get(k);
        if (!prev) byKey.set(k,{...d,_pos:byKey.size});
        else if ((d.edition_count||0)>(prev.edition_count||0)) byKey.set(k,{...d,_pos:prev._pos});
      }
      const deduped=[...byKey.values()].sort((a,b)=>a._pos-b._pos).slice(0,8);
      setResults(deduped);
      setOffline(false);
    } catch(e){
      // Network blocked (e.g. artifact sandbox) → fall back to demo catalogue
      const ql=q.toLowerCase();
      const demo=DEMO_CATALOGUE.filter(b=>
        b.title.toLowerCase().includes(ql)||
        (b.author_name||[]).some(a=>a.toLowerCase().includes(ql))
      );
      setResults(demo);
      setOffline(true);
      if (demo.length===0) setError("Open Library unreachable here — try: Pride, Pachinko, Tolkien, Murakami…");
    }
    finally{setLoading(false);}
  },400),[]);
  return{results,loading,error,offline,search};
}

// ─── Log Modal ────────────────────────────────────────────────────────────────
function LogModal({ onClose, onSave, polls, onPollVote, onPollCreate, onBookSelected, connected }) {
  const [step,setStep]=useState(1);
  const [selected,setSelected]=useState(null);
  const [searchQ,setSearchQ]=useState("");
  const [rating,setRating]=useState(0);
  const [comment,setComment]=useState("");
  const [tags,setTags]=useState([]);
  const [tagInput,setTagInput]=useState("");
  const [country,setCountry]=useState("");
  const [errors,setErrors]=useState({});
  const [workLoading,setWorkLoading]=useState(false);
  const {results,loading,error,offline,search}=useOpenLibrarySearch();

  // ── Open Library work details ──────────────────────────────────────────────
  // book.key is e.g. "/works/OL66554W" → fetch https://openlibrary.org/works/OL66554W.json
  // subject_people becomes the poll's character list. No subject_people → no poll.
  async function fetchWorkDetails(book) {
    // already have a poll cached for this book? skip the network call
    if (polls[book.key] !== undefined) return;
    // demo catalogue entry (network blocked) → use bundled characters
    if (book._demo_people) {
      if (book._demo_people.length >= 2) onPollCreate(book.key, book._demo_people.slice(0,6));
      return;
    }
    setWorkLoading(true);
    try {
      const res = await fetch(`https://openlibrary.org${book.key}.json`);
      if (!res.ok) throw new Error("work fetch failed");
      const work = await res.json();
      const people = (work.subject_people || [])
        .map(p => typeof p === "string" ? p.trim() : "")
        .filter(p => p.length > 0 && p.length <= 200)
        .slice(0, 6);                      // cap at 6 characters per the PRD
      if (people.length >= 2) {
        onPollCreate(book.key, people);    // global poll created at app level
      }
      // refine country if search result didn't have subject_places
      if (!inferCountry(book)) {
        const places = [...(work.subject_places||[]), ...(work.subjects||[])];
        for (const s of places) {
          for (const c of Object.keys(COUNTRY_TO_CONTINENT)) {
            if (String(s).toLowerCase().includes(c.toLowerCase())) {
              setCountry(prev => prev || c);
              break;
            }
          }
        }
      }
    } catch (e) {
      // silent: no poll is acceptable per spec, log stays functional
      console.warn("Open Library work details unavailable:", e.message);
    } finally {
      setWorkLoading(false);
    }
  }

  function selectBook(book) {
    setSelected(book);
    setCountry(inferCountry(book)||"");
    setStep(2);
    if (connected) {
      // backend fetches the work, caches it, creates the poll from subject_people
      setWorkLoading(true);
      Promise.resolve(onBookSelected(book.key)).finally(()=>setWorkLoading(false));
    } else {
      fetchWorkDetails(book);   // demo mode: Open Library direct or bundled demo data
    }
  }

  function addTag(t) {
    const c=t.trim().toLowerCase();
    if (c&&!tags.includes(c)&&tags.length<10) setTags([...tags,c]);
    setTagInput("");
  }

  function save() {
    if (!rating){setErrors({rating:"Please rate this book"});return;}
    onSave({
      bookId:selected.key,
      title:selected.title,
      author:(selected.author_name||[])[0]||"Unknown",
      year:selected.first_publish_year||null,
      coverId:selected.cover_i||null,
      country:country||null,
      continent:COUNTRY_TO_CONTINENT[country]||null,
      rating,comment,tags,
      date:new Date().toISOString().split("T")[0],
    });
  }

  const poll = selected ? polls[selected.key] : null;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{background:"#faf5ef",borderRadius:14,width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e0d4c4",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#faf5ef",zIndex:1}}>
          <div>
            <h2 style={{margin:0,fontSize:17,fontFamily:"Georgia,serif",color:"#1e1208"}}>{step===1?"Find a book":"Log book"}</h2>
            {step===2&&<p style={{margin:"2px 0 0",fontSize:12,color:"#9a7c60"}}>via Open Library</p>}
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#7a5c40"}}>×</button>
        </div>

        <div style={{padding:24}}>
          {/* ── Step 1: search ── */}
          {step===1&&(
            <>
              <div style={{position:"relative",marginBottom:16}}>
                <input value={searchQ} onChange={e=>{setSearchQ(e.target.value);search(e.target.value);}}
                  placeholder="Search Open Library by title or author…"
                  style={{width:"100%",padding:"10px 14px 10px 38px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:14,background:"#fff",fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none"}}/>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#b09070",fontSize:16}}>⌕</span>
              </div>
              {loading&&<p style={{color:"#9a7c60",fontSize:13,textAlign:"center",padding:"12px 0"}}>Searching Open Library…</p>}
              {offline&&results.length>0&&(
                <div style={{marginBottom:10,padding:"8px 12px",background:"#fdf3e4",border:"1px solid #e8d4b0",borderRadius:8}}>
                  <p style={{margin:0,fontSize:12,color:"#8a6530"}}>⚠ Open Library is unreachable in this preview environment — showing the built-in demo catalogue. Live search works once the app runs outside the sandbox.</p>
                </div>
              )}
              {error&&<p style={{color:"#c0392b",fontSize:13}}>{error}</p>}
              {!loading&&searchQ.length>1&&results.length===0&&<p style={{color:"#9a7c60",fontSize:14,textAlign:"center",padding:"16px 0"}}>No results for "{searchQ}"</p>}
              {searchQ.length<=1&&<p style={{color:"#b09070",fontSize:13,textAlign:"center",padding:"12px 0"}}>Start typing to search 30M+ books</p>}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {results.map((book,i)=>(
                  <div key={book.key||i} onClick={()=>selectBook(book)}
                    style={{display:"flex",gap:12,alignItems:"center",padding:"10px 12px",borderRadius:8,cursor:"pointer",border:"1px solid #e0d4c4",background:"#fff"}}
                    onMouseOver={e=>e.currentTarget.style.background="#f0e8d8"}
                    onMouseOut={e=>e.currentTarget.style.background="#fff"}>
                    <BookCover coverId={book.cover_i} title={book.title} size={40}/>
                    <div style={{minWidth:0}}>
                      <p style={{margin:0,fontSize:14,fontWeight:600,color:"#1e1208",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{book.title}</p>
                      <p style={{margin:"2px 0 0",fontSize:12,color:"#7a5c40"}}>{(book.author_name||[])[0]||"Unknown"}{book.first_publish_year?` · ${book.first_publish_year}`:""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Step 2: log details ── */}
          {step===2&&selected&&(
            <>
              <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:20,padding:"12px 14px",background:"#fff",borderRadius:8,border:"1px solid #e0d4c4"}}>
                <BookCover coverId={selected.cover_i} title={selected.title} size={52}/>
                <div>
                  <p style={{margin:0,fontSize:15,fontWeight:700,color:"#1e1208"}}>{selected.title}</p>
                  <p style={{margin:"2px 0 4px",fontSize:13,color:"#7a5c40"}}>{(selected.author_name||[])[0]||"Unknown"}{selected.first_publish_year?` · ${selected.first_publish_year}`:""}</p>
                </div>
              </div>

              <div style={{marginBottom:18}}>
                <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Your rating *</label>
                <StarRating value={rating} onChange={setRating} size={28}/>
                {errors.rating&&<p style={{color:"#c0392b",fontSize:12,margin:"4px 0 0"}}>{errors.rating}</p>}
              </div>

              <div style={{marginBottom:18}}>
                <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Country <span style={{fontWeight:400,color:"#9a7c60"}}>(for your reading map)</span></label>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input value={country} onChange={e=>setCountry(e.target.value)} placeholder="e.g. Nigeria, Japan, France…"
                    style={{flex:1,padding:"8px 12px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:14,fontFamily:"Georgia,serif",background:"#fff",outline:"none"}}/>
                  {country&&COUNTRY_TO_CONTINENT[country]&&<ContinentBadge continent={COUNTRY_TO_CONTINENT[country]}/>}
                </div>
                {country&&!COUNTRY_TO_CONTINENT[country]&&<p style={{margin:"4px 0 0",fontSize:12,color:"#c8802a"}}>Country not recognised — it won't appear on the globe.</p>}
              </div>

              <div style={{marginBottom:18}}>
                <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Review <span style={{fontWeight:400,color:"#9a7c60"}}>(optional)</span></label>
                <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={4} maxLength={5000} placeholder="What did you think?"
                  style={{width:"100%",padding:"10px 12px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:14,fontFamily:"Georgia,serif",resize:"vertical",background:"#fff",boxSizing:"border-box",outline:"none",lineHeight:1.6,color:"#2c1f14"}}/>
                <p style={{margin:"3px 0 0",fontSize:11,color:"#b09070",textAlign:"right"}}>{comment.length}/5000</p>
              </div>

              <div style={{marginBottom:18}}>
                <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Tags</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                  {tags.map(t=><Tag key={t} label={t} onRemove={()=>setTags(tags.filter(x=>x!==t))}/>)}
                </div>
                <input value={tagInput} onChange={e=>setTagInput(e.target.value)}
                  onKeyDown={e=>(e.key==="Enter"||e.key===",")&&(e.preventDefault(),addTag(tagInput))}
                  placeholder="Add tag, press Enter…"
                  style={{width:"100%",padding:"8px 12px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:13,fontFamily:"Georgia,serif",background:"#fff",boxSizing:"border-box",outline:"none"}}/>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                  {TAG_SUGGESTIONS.filter(s=>!tags.includes(s)).slice(0,6).map(s=>(
                    <span key={s} onClick={()=>addTag(s)} style={{fontSize:12,color:"#7a5c40",padding:"3px 8px",border:"1px dashed #c0a880",borderRadius:10,cursor:"pointer",background:"#faf0e4"}}>+ {s}</span>
                  ))}
                </div>
              </div>

              {/* Global character poll — fetched from Open Library subject_people */}
              {workLoading&&(
                <div style={{marginBottom:24,padding:"12px 14px",background:"#fdf6ee",border:"1px solid #e8dfd3",borderRadius:8}}>
                  <p style={{margin:0,fontSize:13,color:"#9a7c60"}}>Checking Open Library for characters…</p>
                </div>
              )}
              {!workLoading&&poll&&(
                <div style={{marginBottom:24}}>
                  <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:8}}>
                    Community character poll
                    {poll.userVote&&<span style={{marginLeft:8,fontSize:12,fontWeight:400,color:"#2e7d32"}}>✓ You voted</span>}
                  </label>
                  <CharacterPoll
                    poll={poll}
                    onVote={ch=>onPollVote(selected.key,ch)}
                    context="modal"
                  />
                </div>
              )}

              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setStep(1)} style={{flex:1,padding:"11px 0",background:"none",border:"1px solid #d0c0a8",color:"#5a3e2b",borderRadius:8,fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>Back</button>
                <button onClick={save} style={{flex:2,padding:"11px 0",background:"#c8802a",border:"none",color:"#fff",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Georgia,serif"}}>Save log</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Log card (diary view) ────────────────────────────────────────────────────
function LogCard({ log, poll, onPollVote, onEdit }) {
  const [expanded,setExpanded]=useState(false);
  return (
    <div style={{background:"#fff",border:"1px solid #e0d4c4",borderRadius:10,padding:"16px 20px"}}>
      <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
        <BookCover coverId={log.coverId} title={log.title} size={52}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
            <div style={{minWidth:0}}>
              <span style={{fontSize:16,fontWeight:700,color:"#1e1208",fontFamily:"Georgia,serif"}}>{log.title}</span>
              <span style={{fontSize:13,color:"#7a5c40",marginLeft:8}}>{log.author}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <StarRating value={log.rating} readOnly size={15}/>
                <span style={{fontSize:13,color:"#9a7c60"}}>{log.rating}</span>
              </div>
              {onEdit&&<button onClick={()=>onEdit(log)} title="Edit this log"
                style={{background:"none",border:"1px solid #d0c0a8",borderRadius:6,color:"#7a5c40",fontSize:12,padding:"4px 10px",cursor:"pointer",fontFamily:"Georgia,serif"}}>
                Edit
              </button>}
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8,alignItems:"center"}}>
            {log.continent&&<ContinentBadge continent={log.continent}/>}
            {log.country&&<span style={{fontSize:12,color:"#7a5c40",background:"#f5f0ea",padding:"2px 7px",borderRadius:10,border:"1px solid #e0d4c4"}}>📍 {log.country}</span>}
            {log.tags.map(t=><Tag key={t} label={t}/>)}
          </div>
          {log.comment&&(
            <>
              <p style={{margin:"10px 0 0",fontSize:14,color:"#3c2a1a",lineHeight:1.65,display:expanded?"block":"-webkit-box",WebkitLineClamp:expanded?undefined:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{log.comment}</p>
              {log.comment.length>200&&<button onClick={()=>setExpanded(!expanded)} style={{background:"none",border:"none",color:"#c8802a",fontSize:13,cursor:"pointer",padding:"4px 0",fontFamily:"Georgia,serif"}}>{expanded?"Read less":"Read more"}</button>}
            </>
          )}

          {/* Global poll — spoiler-gated */}
          {poll&&<CharacterPoll poll={poll} onVote={ch=>onPollVote(log.bookId,ch)} context="card"/>}

          <p style={{margin:"10px 0 0",fontSize:11,color:"#b09070"}}>Logged {log.date}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Edit log modal ───────────────────────────────────────────────────────────
function EditLogModal({ log, onClose, onSave, onDelete }) {
  const [rating,setRating]=useState(log.rating);
  const [comment,setComment]=useState(log.comment||"");
  const [tags,setTags]=useState(log.tags||[]);
  const [tagInput,setTagInput]=useState("");
  const [country,setCountry]=useState(log.country||"");
  const [confirmDel,setConfirmDel]=useState(false);
  const [busy,setBusy]=useState(false);

  function addTag(t){ const c=t.trim().toLowerCase(); if(c&&!tags.includes(c)&&tags.length<10) setTags([...tags,c]); setTagInput(""); }

  async function save(){
    setBusy(true);
    await onSave(log.id, { rating, comment, tags, country });
    setBusy(false);
  }
  async function del(){
    setBusy(true);
    await onDelete(log.id);
    setBusy(false);
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{background:"#faf5ef",borderRadius:14,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e0d4c4",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#faf5ef"}}>
          <h2 style={{margin:0,fontSize:17,fontFamily:"Georgia,serif",color:"#1e1208"}}>Edit log</h2>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#7a5c40"}}>×</button>
        </div>

        <div style={{padding:24}}>
          <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:20,padding:"12px 14px",background:"#fff",borderRadius:8,border:"1px solid #e0d4c4"}}>
            <BookCover coverId={log.coverId} title={log.title} size={48}/>
            <div>
              <p style={{margin:0,fontSize:15,fontWeight:700,color:"#1e1208"}}>{log.title}</p>
              <p style={{margin:"2px 0 0",fontSize:13,color:"#7a5c40"}}>{log.author}</p>
            </div>
          </div>

          <div style={{marginBottom:18}}>
            <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Your rating</label>
            <StarRating value={rating} onChange={setRating} size={28}/>
          </div>

          <div style={{marginBottom:18}}>
            <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Country <span style={{fontWeight:400,color:"#9a7c60"}}>(reading map)</span></label>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input value={country} onChange={e=>setCountry(e.target.value)} placeholder="e.g. Nigeria, Japan…"
                style={{flex:1,padding:"8px 12px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:14,fontFamily:"Georgia,serif",background:"#fff",outline:"none"}}/>
              {country&&COUNTRY_TO_CONTINENT[country]&&<ContinentBadge continent={COUNTRY_TO_CONTINENT[country]}/>}
            </div>
          </div>

          <div style={{marginBottom:18}}>
            <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Review</label>
            <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={4} maxLength={5000}
              style={{width:"100%",padding:"10px 12px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:14,fontFamily:"Georgia,serif",resize:"vertical",background:"#fff",boxSizing:"border-box",outline:"none",lineHeight:1.6,color:"#2c1f14"}}/>
            <p style={{margin:"3px 0 0",fontSize:11,color:"#b09070",textAlign:"right"}}>{comment.length}/5000</p>
          </div>

          <div style={{marginBottom:24}}>
            <label style={{fontSize:13,fontWeight:600,color:"#5a3e2b",display:"block",marginBottom:6}}>Tags</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              {tags.map(t=><Tag key={t} label={t} onRemove={()=>setTags(tags.filter(x=>x!==t))}/>)}
            </div>
            <input value={tagInput} onChange={e=>setTagInput(e.target.value)}
              onKeyDown={e=>(e.key==="Enter"||e.key===",")&&(e.preventDefault(),addTag(tagInput))}
              placeholder="Add tag, press Enter…"
              style={{width:"100%",padding:"8px 12px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:13,fontFamily:"Georgia,serif",background:"#fff",boxSizing:"border-box",outline:"none"}}/>
          </div>

          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {!confirmDel?(
              <button onClick={()=>setConfirmDel(true)} disabled={busy}
                style={{padding:"11px 16px",background:"none",border:"1px solid #c0392b",color:"#c0392b",borderRadius:8,fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                Delete
              </button>
            ):(
              <button onClick={del} disabled={busy}
                style={{padding:"11px 16px",background:"#c0392b",border:"none",color:"#fff",borderRadius:8,fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>
                Confirm delete?
              </button>
            )}
            <div style={{flex:1}}/>
            <button onClick={onClose} style={{padding:"11px 16px",background:"none",border:"1px solid #d0c0a8",color:"#5a3e2b",borderRadius:8,fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancel</button>
            <button onClick={save} disabled={busy}
              style={{padding:"11px 22px",background:"#c8802a",border:"none",color:"#fff",borderRadius:8,fontSize:14,fontWeight:600,cursor:busy?"wait":"pointer",fontFamily:"Georgia,serif",opacity:busy?0.7:1}}>
              {busy?"…":"Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Five Favourites ──────────────────────────────────────────────────────────
function FiveFavourites({ logs, favs, onSetFav, onClearFav }) {
  const [picker,setPicker]=useState(null);
  const filled=Object.values(favs).filter(Boolean).length;
  const logMap=Object.fromEntries(logs.map(l=>[l.bookId,l]));
  return (
    <div style={{marginBottom:32}}>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:12}}>
        <h2 style={{margin:0,fontSize:18,fontFamily:"Georgia,serif",color:"#1e1208"}}>5 Favourites</h2>
        <span style={{fontSize:12,color:filled===5?"#2e7d32":"#c8802a",fontWeight:600}}>{filled}/5 continents {filled===5?"— complete ✓":""}</span>
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        {CONTINENTS.map(continent=>{
          const log=logMap[favs[continent]];
          return (
            <div key={continent} style={{flex:"0 0 auto",width:110}}>
              <div style={{position:"relative",cursor:"pointer"}} onClick={()=>setPicker(continent)}>
                {log?(
                  <>
                    <BookCover coverId={log.coverId} title={log.title} size={110}/>
                    <div style={{position:"absolute",bottom:4,left:4}}><ContinentBadge continent={continent}/></div>
                    <div style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,0.55)",color:"#fff",width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11}}>✎</div>
                  </>
                ):(
                  <div style={{width:110,height:154,borderRadius:6,border:"2px dashed #c8a96e",background:"#faf5ef",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6}}>
                    <span style={{fontSize:22,color:"#c8a96e"}}>+</span>
                    <span style={{fontSize:10,color:"#9a7060",textAlign:"center",lineHeight:1.3}}>Add {continent}</span>
                  </div>
                )}
              </div>
              <p style={{margin:"6px 0 0",fontSize:11,color:"#7a5c40",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{log?log.title:continent}</p>
            </div>
          );
        })}
      </div>
      {picker&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setPicker(null)}>
          <div style={{background:"#faf5ef",borderRadius:12,padding:24,width:360,maxHeight:"70vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{margin:0,fontSize:16,fontFamily:"Georgia,serif"}}>Favourite for {picker}</h3>
              <button onClick={()=>setPicker(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#7a5c40"}}>×</button>
            </div>
            {logs.filter(l=>l.continent===picker).length===0&&<p style={{color:"#9a7c60",fontSize:14}}>No books from {picker} logged yet.</p>}
            {logs.filter(l=>l.continent===picker).map(log=>(
              <div key={log.id} onClick={()=>{onSetFav(picker,log.bookId);setPicker(null);}}
                style={{display:"flex",gap:12,alignItems:"center",padding:"10px 12px",borderRadius:8,cursor:"pointer",marginBottom:6,background:favs[picker]===log.bookId?"#f0e8d8":"transparent",border:favs[picker]===log.bookId?"1px solid #c8802a":"1px solid transparent"}}
                onMouseOver={e=>e.currentTarget.style.background="#f0e8d8"} onMouseOut={e=>e.currentTarget.style.background=favs[picker]===log.bookId?"#f0e8d8":"transparent"}>
                <BookCover coverId={log.coverId} title={log.title} size={36}/>
                <div>
                  <p style={{margin:0,fontSize:14,fontWeight:600,color:"#1e1208"}}>{log.title}</p>
                  <p style={{margin:0,fontSize:12,color:"#7a5c40"}}>{log.author}</p>
                </div>
              </div>
            ))}
            {favs[picker]&&<button onClick={()=>{onClearFav(picker);setPicker(null);}} style={{marginTop:12,background:"none",border:"1px solid #c0392b",color:"#c0392b",padding:"8px 14px",borderRadius:6,cursor:"pointer",fontSize:13,width:"100%"}}>Remove</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Auth screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuthed, onSkip }) {
  const [mode,setMode]=useState("login");        // "login" | "register"
  const [username,setUsername]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);

  async function submit() {
    setErr(""); setBusy(true);
    try {
      const data = mode==="register"
        ? await api.register(username,email,password)
        : await api.login(email,password);
      setToken(data.token);
      onAuthed(data.user);
    } catch(e) {
      // Backend unreachable → likely not started, or running in the sandbox preview
      if (e.message.includes("fetch") || e.name==="TypeError")
        setErr("Backend unreachable on "+API_BASE+" — start Flask (python run.py) or continue in demo mode below.");
      else setErr(e.message);
    } finally { setBusy(false); }
  }

  const input = {width:"100%",padding:"10px 14px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:14,background:"#fff",fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none",marginBottom:12};

  return (
    <div style={{minHeight:"100vh",background:"#f7f3ee",fontFamily:"Georgia,serif",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{width:"100%",maxWidth:380}}>
        <h1 style={{textAlign:"center",color:"#1e1208",fontSize:32,letterSpacing:"0.08em",margin:"0 0 4px"}}>BOOXXED</h1>
        <p style={{textAlign:"center",color:"#9a7c60",fontSize:14,margin:"0 0 28px"}}>Your reading life, logged.</p>

        <div style={{background:"#faf5ef",border:"1px solid #e0d4c4",borderRadius:14,padding:28}}>
          <div style={{display:"flex",gap:0,marginBottom:20,borderBottom:"1px solid #e0d4c4"}}>
            {[["login","Sign in"],["register","Create account"]].map(([m,label])=>(
              <button key={m} onClick={()=>{setMode(m);setErr("");}}
                style={{flex:1,background:"none",border:"none",padding:"10px 0",fontSize:14,fontFamily:"Georgia,serif",cursor:"pointer",
                  color:mode===m?"#c8802a":"#9a7c60",borderBottom:mode===m?"2px solid #c8802a":"2px solid transparent",fontWeight:mode===m?600:400}}>
                {label}
              </button>
            ))}
          </div>

          {mode==="register"&&(
            <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username (unique)" style={input}/>
          )}
          <input value={email} onChange={e=>setEmail(e.target.value)}
            placeholder={mode==="register"?"Email":"Email or username"}
            type={mode==="register"?"email":"text"} style={input}/>
          <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password (8+ characters)" type="password" style={input}
            onKeyDown={e=>e.key==="Enter"&&submit()}/>

          {err&&<p style={{color:"#c0392b",fontSize:13,margin:"0 0 12px",lineHeight:1.5}}>{err}</p>}

          <button onClick={submit} disabled={busy}
            style={{width:"100%",padding:"12px 0",background:"#c8802a",border:"none",color:"#fff",borderRadius:8,fontSize:15,fontWeight:600,cursor:busy?"wait":"pointer",fontFamily:"Georgia,serif",opacity:busy?0.7:1}}>
            {busy?"…":(mode==="register"?"Create account":"Sign in")}
          </button>
        </div>

        <button onClick={onSkip}
          style={{display:"block",margin:"16px auto 0",background:"none",border:"none",color:"#9a7c60",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",textDecoration:"underline"}}>
          Continue in demo mode (no backend, data not saved)
        </button>
      </div>
    </div>
  );
}

// ─── Readers — visit another user's library ───────────────────────────────────
// Search a reader by username, then browse their favourites, recent readings
// and bookshelves — all read-only, reusing the same components as your own views.
function ReadersView({ connected }) {
  const [q,setQ]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [profile,setProfile]=useState(null);   // {user, logs, favs, shelves}
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [subview,setSubview]=useState("overview");   // overview | shelves

  const doSearch=useCallback(debounce(async term=>{
    if (!term||term.length<2){ setResults([]); return; }
    setSearching(true);
    try { setResults(await api.searchUsers(term)); } catch { setResults([]); }
    finally { setSearching(false); }
  },350),[]);

  async function openProfile(username) {
    setLoading(true); setError(null);
    try {
      const d=await api.getUser(username);
      let shelves=(d.shelves||[]).map(normalizeShelf);
      if (!shelves.length) shelves=[{id:"all",name:"All my books",color:null,isDefault:true,bookIds:[]}];
      setProfile({ user:d.user, logs:(d.logs||[]).map(normalizeLog), favs:d.favourites||{}, shelves });
      setSubview("overview");
    } catch(e){ setError("Could not load this reader: "+e.message); }
    finally { setLoading(false); }
  }

  if (!connected) return (
    <div style={{textAlign:"center",padding:"60px 0"}}>
      <h2 style={{margin:"0 0 8px",fontSize:22,fontFamily:"Georgia,serif",color:"#1e1208"}}>Readers</h2>
      <p style={{color:"#9a7c60",fontSize:14}}>Sign in to search other readers and visit their libraries.</p>
    </div>
  );

  // ── A reader's profile ──
  if (profile) {
    const { user:u, logs, favs, shelves } = profile;
    const name=u.display_name||u.username;
    const avg=logs.length?(logs.reduce((s,l)=>s+l.rating,0)/logs.length).toFixed(1):"—";
    const countries=new Set(logs.map(l=>l.country).filter(Boolean)).size;
    const favEntries=CONTINENTS.map(c=>[c,favs[c]]).filter(([,b])=>b);
    return (
      <div>
        <button onClick={()=>setProfile(null)}
          style={{background:"none",border:"none",color:"#c8802a",fontSize:14,cursor:"pointer",fontFamily:"Georgia,serif",padding:0,marginBottom:16}}>
          ← Back to search
        </button>

        <div style={{display:"flex",alignItems:"flex-end",gap:20,marginBottom:20,paddingBottom:20,borderBottom:"1px solid #e0d4c4"}}>
          <div style={{width:68,height:68,borderRadius:"50%",background:"#2E5C4F",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:700,color:"#fff",flexShrink:0}}>{name[0].toUpperCase()}</div>
          <div style={{flex:1}}>
            <h1 style={{margin:"0 0 2px",fontSize:22,fontFamily:"Georgia,serif"}}>{name}</h1>
            <p style={{margin:"0 0 10px",color:"#7a5c40",fontSize:13}}>
              @{u.username}{u.location?` · ${u.location}`:""}
            </p>
            {u.bio&&<p style={{margin:"0 0 10px",color:"#5a3e2b",fontSize:14}}>{u.bio}</p>}
            <div style={{display:"flex",gap:20}}>
              {[[logs.length,"Books"],[avg,"Avg rating"],[countries,"Countries"]].map(([n,label])=>(
                <div key={label} style={{textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:700,color:"#1e1208"}}>{n}</div>
                  <div style={{fontSize:11,color:"#9a7c60",textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* sub-tabs: overview / bookshelves */}
        <div style={{display:"flex",gap:0,marginBottom:20,borderBottom:"1px solid #e0d4c4"}}>
          {[["overview","Overview"],["shelves","Bookshelves"]].map(([v,label])=>(
            <button key={v} onClick={()=>setSubview(v)}
              style={{background:"none",border:"none",padding:"10px 16px",fontSize:14,fontFamily:"Georgia,serif",cursor:"pointer",
                color:subview===v?"#c8802a":"#9a7c60",borderBottom:subview===v?"2px solid #c8802a":"2px solid transparent",fontWeight:subview===v?600:400}}>
              {label}
            </button>
          ))}
        </div>

        {subview==="overview"&&(
          <>
            <h2 style={{margin:"0 0 12px",fontSize:18,fontFamily:"Georgia,serif"}}>Favourites by continent</h2>
            {favEntries.length===0&&<p style={{color:"#9a7c60",fontSize:14,margin:"0 0 24px"}}>{name} hasn't picked any continent favourites yet.</p>}
            <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:28}}>
              {favEntries.map(([c,b])=>(
                <div key={c} style={{width:110,textAlign:"center"}}>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:6}}>
                    <BookCover coverId={b.cover_id} title={b.title} size={72}/>
                  </div>
                  <ContinentBadge continent={c}/>
                  <p style={{margin:"5px 0 0",fontSize:12,color:"#3c2a1a",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{b.title}</p>
                </div>
              ))}
            </div>

            <h2 style={{margin:"0 0 12px",fontSize:18,fontFamily:"Georgia,serif"}}>Recent readings</h2>
            {logs.length===0&&<p style={{color:"#9a7c60",fontSize:14}}>{name} hasn't logged any books yet.</p>}
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {logs.slice(0,6).map(log=>(
                <LogCard key={log.id} log={log} poll={null} onPollVote={()=>{}}/>
              ))}
            </div>
          </>
        )}

        {subview==="shelves"&&(
          <Bookshelf logs={logs} shelves={shelves} readOnly title={`${name}'s bookshelves`}/>
        )}
      </div>
    );
  }

  // ── Search ──
  return (
    <div>
      <h2 style={{margin:"0 0 6px",fontSize:22,fontFamily:"Georgia,serif",color:"#1e1208"}}>Readers</h2>
      <p style={{margin:"0 0 16px",color:"#9a7c60",fontSize:14}}>Search a reader to visit their favourites, recent readings and bookshelves.</p>
      <div style={{position:"relative",marginBottom:16,maxWidth:420}}>
        <input value={q} onChange={e=>{setQ(e.target.value);doSearch(e.target.value);}}
          placeholder="Search readers by username…"
          style={{width:"100%",padding:"10px 14px 10px 38px",border:"1px solid #d0c0a8",borderRadius:8,fontSize:14,background:"#fff",fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none"}}/>
        <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#b09070",fontSize:16}}>⌕</span>
      </div>
      {searching&&<p style={{color:"#9a7c60",fontSize:13}}>Searching…</p>}
      {loading&&<p style={{color:"#9a7c60",fontSize:13}}>Loading profile…</p>}
      {error&&<p style={{color:"#c0392b",fontSize:13}}>{error}</p>}
      {!searching&&q.length>1&&results.length===0&&<p style={{color:"#9a7c60",fontSize:14}}>No readers found for "{q}".</p>}
      <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:420}}>
        {results.map(r=>(
          <div key={r.username} onClick={()=>openProfile(r.username)}
            style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"#fff",border:"1px solid #e0d4c4",borderRadius:8,cursor:"pointer"}}
            onMouseOver={e=>e.currentTarget.style.background="#f7f1e7"}
            onMouseOut={e=>e.currentTarget.style.background="#fff"}>
            <div style={{width:38,height:38,borderRadius:"50%",background:"#2E5C4F",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0}}>
              {(r.display_name||r.username)[0].toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <p style={{margin:0,fontSize:14,fontWeight:600,color:"#1e1208"}}>{r.display_name||r.username}</p>
              <p style={{margin:"1px 0 0",fontSize:12,color:"#9a7c60"}}>@{r.username}</p>
            </div>
            <span style={{fontSize:12,color:"#9a7c60",flexShrink:0}}>{r.books} book{r.books!==1?"s":""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view,setView]=useState("profile");
  const [user,setUser]=useState(null);           // backend user, null = not signed in
  const [demoMode,setDemoMode]=useState(false);  // true = in-memory, no backend
  const [booting,setBooting]=useState(true);
  const [logs,setLogs]=useState(INITIAL_LOGS);
  const [polls,setPolls]=useState(INITIAL_POLLS);
  const [favs,setFavs]=useState(INITIAL_FAVS);
  const [shelves,setShelves]=useState(()=>{
    try { const s=JSON.parse(window.localStorage.getItem("booxxed_demo_shelves"));
          if (Array.isArray(s)&&s.some(x=>x.isDefault)) return s; } catch {}
    return DEFAULT_SHELVES;
  });
  const [logModal,setLogModal]=useState(false);
  const [editLog,setEditLog]=useState(null);

  const connected = !!user && !demoMode;

  // Demo mode: custom shelves survive reloads via localStorage
  useEffect(()=>{
    if (!connected) { try { window.localStorage.setItem("booxxed_demo_shelves", JSON.stringify(shelves)); } catch {} }
  },[shelves,connected]);

  // ── boot: if a token is stored, restore the session and load data ──────────
  useEffect(()=>{
    (async ()=>{
      if (!_token) { setBooting(false); return; }
      try {
        const me = await api.me();
        setUser(me);
        await loadAll();
      } catch { setToken(null); }
      setBooting(false);
    })();
  },[]);

  async function loadAll() {
    const [rawLogs, rawFavs, rawShelves] = await Promise.all([api.getLogs(), api.getFavourites(), api.getShelves()]);
    const normLogs = rawLogs.map(normalizeLog);
    setLogs(normLogs);
    setShelves(rawShelves.map(normalizeShelf));
    setFavs({
      Africa:rawFavs.Africa?.book.ol_key||null,   Americas:rawFavs.Americas?.book.ol_key||null,
      Asia:rawFavs.Asia?.book.ol_key||null,       Europe:rawFavs.Europe?.book.ol_key||null,
      Oceania:rawFavs.Oceania?.book.ol_key||null,
    });
    // hydrate polls for every logged book
    const pollEntries = await Promise.all(normLogs.map(async l=>{
      try { const {poll} = await api.getPoll(l.bookId); return [l.bookId, normalizePoll(poll)]; }
      catch { return [l.bookId, null]; }
    }));
    setPolls(Object.fromEntries(pollEntries.filter(([,p])=>p)));
  }

  async function handleAuthed(u) {
    setUser(u); setDemoMode(false);
    setLogs([]); setPolls({}); setFavs({Africa:null,Americas:null,Asia:null,Europe:null,Oceania:null});
    setShelves(DEFAULT_SHELVES);
    try { await loadAll(); } catch(e){ console.warn("initial load failed:", e.message); }
  }

  function handleLogout() {
    setToken(null); setUser(null); setDemoMode(false);
    setLogs(INITIAL_LOGS); setPolls(INITIAL_POLLS); setFavs(INITIAL_FAVS);
    setShelves(DEFAULT_SHELVES);
  }

  // ── Bookshelves (max 3, one default = all read books) ──────────────────────
  async function handleShelfCreate(name, color) {
    if (shelves.length >= MAX_SHELVES) { alert(`You can have at most ${MAX_SHELVES} shelves.`); return null; }
    if (connected) {
      try { const s = await api.createShelf(name, color); const n = normalizeShelf(s);
            setShelves(p=>[...p,n]); return n; }
      catch(e){ alert("Could not create shelf: "+e.message); return null; }
    }
    const n = { id:Date.now(), name, color:color||null, isDefault:false, bookIds:[] };
    setShelves(p=>[...p,n]); return n;
  }

  async function handleShelfUpdate(id, patch) {
    if (connected) {
      try { const s = await api.updateShelf(id, patch);
            setShelves(p=>p.map(x=>x.id===id?normalizeShelf(s):x)); return; }
      catch(e){ alert("Could not update shelf: "+e.message); return; }
    }
    setShelves(p=>p.map(x=>x.id===id?{...x,...patch}:x));
  }

  async function handleShelfDelete(id) {
    if (connected) {
      try { await api.deleteShelf(id); }
      catch(e){ alert("Could not delete shelf: "+e.message); return; }
    }
    setShelves(p=>p.filter(x=>x.id!==id||x.isDefault));
  }

  async function handleShelfBooks(id, bookIds) {
    if (connected) {
      try { const s = await api.setShelfBooks(id, bookIds);
            setShelves(p=>p.map(x=>x.id===id?normalizeShelf(s):x)); return; }
      catch(e){ alert("Could not update shelf books: "+e.message); return; }
    }
    setShelves(p=>p.map(x=>x.id===id?{...x,bookIds}:x));
  }

  // ── Update / delete an existing log ────────────────────────────────────────
  async function handleUpdateLog(id, patch) {
    if (connected) {
      try {
        const saved = await api.updateLog(id, patch);
        setLogs(prev=>prev.map(l=>l.id===id?normalizeLog(saved):l));
        setEditLog(null);
        return;
      } catch(e){ alert("Update failed: "+e.message); return; }
    }
    // demo mode: patch in place
    setLogs(prev=>prev.map(l=>l.id===id?{
      ...l, rating:patch.rating, comment:patch.comment, tags:patch.tags,
      country:patch.country||null, continent:COUNTRY_TO_CONTINENT[patch.country]||null,
    }:l));
    setEditLog(null);
  }

  async function handleDeleteLog(id) {
    if (connected) {
      try { await api.deleteLog(id); }
      catch(e){ alert("Delete failed: "+e.message); return; }
    }
    setLogs(prev=>prev.filter(l=>l.id!==id));
    setEditLog(null);
  }

  // ── Poll vote: backend if connected, local state otherwise ─────────────────
  async function handlePollVote(bookId, character) {
    const poll = polls[bookId];
    if (!poll || poll.userVote===character) return;

    if (connected && poll._ids?.[character]) {
      try {
        const {poll:updated} = await api.votePoll(bookId, poll._ids[character]);
        setPolls(prev=>({ ...prev, [bookId]: normalizePoll(updated) }));
        return;
      } catch(e){ console.warn("vote failed, applying locally:", e.message); }
    }
    // local fallback (demo mode / backend error)
    setPolls(prev=>{
      const p=prev[bookId];
      if (!p||p.userVote===character) return prev;
      const votes={...p.votes};
      if (p.userVote) votes[p.userVote]=Math.max(0,(votes[p.userVote]||0)-1);
      votes[character]=(votes[character]||0)+1;
      return { ...prev, [bookId]: { ...p, userVote:character, votes } };
    });
  }

  // Local poll creation — used in demo mode only; connected mode gets polls from the API
  function handlePollCreate(bookId, characters) {
    setPolls(prev=>{
      if (prev[bookId] !== undefined) return prev;
      return { ...prev, [bookId]: { characters, votes:Object.fromEntries(characters.map(c=>[c,0])), userVote:null } };
    });
  }

  // Connected mode: fetch book detail (creates poll server-side) then the poll
  async function handleBookSelected(olKey) {
    if (!connected) return;
    try {
      await api.getBookDetail(olKey);
      const {poll} = await api.getPoll(olKey);
      if (poll) setPolls(prev=>({ ...prev, [olKey]: normalizePoll(poll) }));
    } catch(e){ console.warn("book detail/poll fetch failed:", e.message); }
  }

  // ── Save log ────────────────────────────────────────────────────────────────
  async function handleSave(newLog) {
    if (connected) {
      try {
        const saved = await api.createLog({
          ol_key:newLog.bookId, title:newLog.title, author:newLog.author,
          year:newLog.year, cover_id:newLog.coverId,
          country:newLog.country, continent:newLog.continent,
          rating:newLog.rating, comment:newLog.comment, tags:newLog.tags,
        });
        setLogs(prev=>[...prev, normalizeLog(saved)]);
        setLogModal(false);
        return;
      } catch(e){
        alert("Save failed: "+e.message);   // e.g. duplicate log (409)
        return;
      }
    }
    setLogs(prev=>[...prev,{...newLog,id:Date.now()}]);
    setLogModal(false);
  }

  // ── Favourites ──────────────────────────────────────────────────────────────
  async function handleSetFav(continent, bookId) {
    if (connected) {
      try { await api.setFavourite(continent, bookId); }
      catch(e){ alert("Could not set favourite: "+e.message); return; }
    }
    setFavs(p=>({...p,[continent]:bookId}));
  }
  async function handleClearFav(continent) {
    if (connected) {
      try { await api.clearFavourite(continent); }
      catch(e){ console.warn(e.message); }
    }
    setFavs(p=>({...p,[continent]:null}));
  }

  const avgRating = logs.length ? (logs.reduce((s,l)=>s+l.rating,0)/logs.length).toFixed(1) : "—";
  const countriesCount = new Set(logs.map(l=>l.country).filter(Boolean)).size;
  const displayName = user?.username || "Demo Reader";

  // ── Gates: boot spinner → auth screen → app ────────────────────────────────
  if (booting) return (
    <div style={{minHeight:"100vh",background:"#f7f3ee",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Georgia,serif",color:"#9a7c60"}}>Loading…</div>
  );
  if (!user && !demoMode) return <AuthScreen onAuthed={handleAuthed} onSkip={()=>setDemoMode(true)}/>;

  return (
    <div style={{minHeight:"100vh",background:"#f7f3ee",fontFamily:"Georgia,serif",color:"#2c1f14"}}>
      <nav style={{background:"#1e1208",borderBottom:"1px solid #3a2518",padding:"0 24px",display:"flex",alignItems:"center",position:"sticky",top:0,zIndex:100}}>
        <span style={{color:"#c8a96e",fontSize:22,fontWeight:700,letterSpacing:"0.08em",marginRight:32,padding:"14px 0"}}>BOOXXED</span>
        {[["profile","My books"],["shelf","Bookshelf"],["map","Reading map"],["readers","Readers"]].map(([v,label])=>(
          <button key={v} onClick={()=>setView(v)} style={{background:"none",border:"none",color:view===v?"#c8a96e":"#8a7060",fontSize:14,padding:"16px 14px",cursor:"pointer",borderBottom:view===v?"2px solid #c8a96e":"2px solid transparent",fontFamily:"Georgia,serif"}}>
            {label}
          </button>
        ))}
        <div style={{flex:1}}/>
        <span style={{fontSize:11,color:connected?"#6a9a5f":"#b09070",marginRight:14,padding:"3px 8px",border:`1px solid ${connected?"#6a9a5f":"#b09070"}`,borderRadius:10}}>
          {connected?"● Connected":"○ Demo mode"}
        </span>
        <button onClick={()=>setLogModal(true)} style={{background:"#c8802a",border:"none",color:"#fff",fontSize:13,fontWeight:600,padding:"8px 18px",borderRadius:6,cursor:"pointer",fontFamily:"Georgia,serif"}}>
          + Log a book
        </button>
        <button onClick={handleLogout} title={connected?"Sign out":"Back to sign in"}
          style={{background:"none",border:"none",color:"#8a7060",fontSize:13,padding:"8px 0 8px 14px",cursor:"pointer",fontFamily:"Georgia,serif"}}>
          {connected?"Sign out":"Sign in"}
        </button>
      </nav>

      <div style={{maxWidth:860,margin:"0 auto",padding:"24px 16px"}}>
        {view==="profile"&&(
          <>
            <div style={{display:"flex",alignItems:"flex-end",gap:20,marginBottom:32,paddingBottom:24,borderBottom:"1px solid #e0d4c4"}}>
              <div style={{width:68,height:68,borderRadius:"50%",background:"#8B4513",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:700,color:"#fff",flexShrink:0}}>{displayName[0].toUpperCase()}</div>
              <div style={{flex:1}}>
                <h1 style={{margin:"0 0 4px",fontSize:22,fontFamily:"Georgia,serif"}}>{displayName}</h1>
                <p style={{margin:"0 0 10px",color:"#7a5c40",fontSize:14}}>{connected?"Synced with your Booxxed account":"Demo mode — data lives in this tab only"}</p>
                <div style={{display:"flex",gap:20}}>
                  {[[logs.length,"Books"],[avgRating,"Avg rating"],[countriesCount,"Countries"]].map(([n,label])=>(
                    <div key={label} style={{textAlign:"center"}}>
                      <div style={{fontSize:18,fontWeight:700,color:"#1e1208"}}>{n}</div>
                      <div style={{fontSize:11,color:"#9a7c60",textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <FiveFavourites logs={logs} favs={favs} onSetFav={handleSetFav} onClearFav={handleClearFav}/>
            <div>
              <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:16}}>
                <h2 style={{margin:0,fontSize:18,fontFamily:"Georgia,serif"}}>Reading diary</h2>
                <span style={{fontSize:13,color:"#9a7c60"}}>{logs.length} books logged</span>
              </div>
              {logs.length===0&&<p style={{color:"#9a7c60",textAlign:"center",padding:"32px 0"}}>Your diary is empty — log your first book above.</p>}
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {[...logs].reverse().map(log=>(
                  <LogCard key={log.id} log={log} poll={polls[log.bookId]||null} onPollVote={handlePollVote} onEdit={setEditLog}/>
                ))}
              </div>
            </div>
          </>
        )}
        {view==="shelf"&&(
          <Bookshelf logs={logs} shelves={shelves} onEditLog={setEditLog}
            onCreateShelf={handleShelfCreate} onUpdateShelf={handleShelfUpdate}
            onDeleteShelf={handleShelfDelete} onSetShelfBooks={handleShelfBooks}/>
        )}
        {view==="map"&&<GlobeView logs={logs} onEditLog={setEditLog}/>}
        {view==="readers"&&<ReadersView connected={connected}/>}
      </div>

      {logModal&&(
        <LogModal
          onClose={()=>setLogModal(false)}
          onSave={handleSave}
          onPollCreate={handlePollCreate}
          onBookSelected={handleBookSelected}
          connected={connected}
          polls={polls}
          onPollVote={handlePollVote}
        />
      )}

      {editLog&&(
        <EditLogModal
          log={editLog}
          onClose={()=>setEditLog(null)}
          onSave={handleUpdateLog}
          onDelete={handleDeleteLog}
        />
      )}
    </div>
  );
}
