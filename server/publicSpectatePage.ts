type PublicCompetition = {
  id: string;
  title: string;
  status: string;
  participants?: number;
  startAt: number;
  endAt: number;
  cashPrize?: {
    currency?: string;
    total?: number;
    label?: string;
    imageUrl?: string;
    description?: string;
    breakdown?: Array<{ rank: number; amount: number }>;
    items?: Array<{ rank?: number; imageUrl?: string; title?: string; description?: string }>;
  } | null;
};

type PublicLeaderboardRow = {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  pnlPercent: number;
  pnlUsd: number;
  tradesCount: number;
  breached?: boolean;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function renderPublicSpectatePage(input: {
  competition: PublicCompetition;
  leaderboard: PublicLeaderboardRow[];
  publicUrl: string;
  appUrl: string;
}): string {
  const { competition, leaderboard, publicUrl, appUrl } = input;
  const title = `${competition.title} — Live BTF Arena`;
  const description = `Regarde ${competition.participants || leaderboard.length} traders s’affronter en direct sur BTF Arena.`;
  const initialData = jsonForScript({ competition, leaderboard });
  const prize = competition.cashPrize || null;
  const hasPrize = Boolean(
    prize && (prize.label || prize.imageUrl || (prize.total && prize.total > 0) || (prize.items && prize.items.length) || (prize.breakdown && prize.breakdown.length)),
  );
  const prizeTitle = prize?.label || (prize?.total && prize.total > 0
    ? `${Math.round(prize.total).toLocaleString('fr-FR')} ${prize.currency || 'USD'}`
    : 'Lots à gagner');
  const prizeHtml = hasPrize && prize ? `
    <section class="prizes">
      <span>LOTS À GAGNER</span>
      <h2>${escapeHtml(prizeTitle)}</h2>
      <div class="hero-lot">
        ${prize.imageUrl ? `<img src="${escapeHtml(prize.imageUrl)}" alt="" />` : ''}
        <div>
          <strong>${escapeHtml(prizeTitle)}</strong>
          ${prize.description ? `<small>${escapeHtml(prize.description)}</small>` : '<small>Récompensent les meilleurs traders à la clôture de l’arène.</small>'}
        </div>
      </div>
      ${prize.breakdown && prize.breakdown.length ? `<ul>${prize.breakdown.map((row) => `<li><span>#${row.rank}</span><b>${escapeHtml(String(Math.round(row.amount)))} ${escapeHtml(prize.currency || 'USD')}</b></li>`).join('')}</ul>` : ''}
      ${prize.items && prize.items.length ? `<div class="items">${prize.items.map((item) => `<article>${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" />` : ''}<strong>${escapeHtml(item.title || (item.rank ? `#${item.rank}` : 'Lot'))}</strong></article>`).join('')}</div>` : ''}
    </section>` : '';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#07070a" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(publicUrl)}" />
  <meta property="og:image" content="${escapeHtml(new URL('/assets/pictures/btf-arena-seo.webp', appUrl).toString())}" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    :root{color-scheme:dark;--red:#ee243c;--green:#43dc89;--muted:#8d8791}
    *{box-sizing:border-box}body{margin:0;background:#07070a;color:#f6f3f7;font-family:Inter,Arial,sans-serif}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 90% 0,rgba(238,36,60,.17),transparent 35%),repeating-linear-gradient(115deg,rgba(255,255,255,.014) 0 2px,transparent 2px 8px)}
    main{position:relative;width:min(100%,760px);min-height:100vh;margin:auto;padding:18px 14px 92px}
    .top{display:flex;align-items:center;justify-content:space-between}.logo{width:138px;height:auto}.share{padding:9px 13px;border:1px solid #3a3038;border-radius:5px;background:#171319;color:#fff;font-weight:800}
    .hero{margin-top:14px;padding:18px;border:1px solid rgba(238,36,60,.35);background:linear-gradient(145deg,rgba(238,36,60,.12),rgba(14,12,16,.95));clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
    .live{color:#ff7082;font-size:10px;font-weight:900;letter-spacing:.18em}.live:before{content:"";display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:var(--red);box-shadow:0 0 12px var(--red)}
    h1{margin:8px 0 0;font-size:clamp(31px,8vw,55px);font-style:italic;line-height:.88;text-transform:uppercase}.hero footer{margin-top:16px;display:flex;gap:20px;color:var(--muted);font-size:11px}.hero footer strong{display:block;margin-top:3px;color:#fff;font-size:18px}
    .chart,.ranking{margin-top:14px;border:1px solid #242027;background:rgba(12,11,15,.94)}.section-head{padding:12px 13px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #242027}.section-head strong{font-style:italic;text-transform:uppercase}.section-head span{color:var(--muted);font-size:9px}
    canvas{width:100%;height:250px;display:block}.rows article{min-height:58px;padding:8px 12px;display:grid;grid-template-columns:34px 38px minmax(0,1fr) auto;align-items:center;gap:9px;border-bottom:1px solid #1b191e}.rows article:last-child{border:0}.rows article.top3{background:linear-gradient(90deg,rgba(255,210,87,.08),transparent)}.rows b{font-style:italic;color:#aaa3ad}.rows img,.avatar{width:36px;height:36px;display:grid;place-items:center;border:1px solid #343039;border-radius:50%;background:#211e24;object-fit:cover;font-size:9px;font-weight:900}.name{overflow:hidden;font-size:11px;font-weight:900;text-overflow:ellipsis;white-space:nowrap}.name small{display:block;margin-top:3px;color:#77717a;font-size:8px}.pnl{text-align:right;font-size:11px;font-weight:900}.positive{color:var(--green)}.negative{color:#ff6074}
    .empty{padding:35px;text-align:center;color:var(--muted)}.prizes{margin-top:14px;padding:16px;border:1px solid rgba(245,190,69,.35);background:linear-gradient(145deg,rgba(245,190,69,.1),rgba(14,12,16,.95));clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}.prizes>span{color:#f5c65f;font-size:10px;font-weight:900;letter-spacing:.18em}.prizes h2{margin:6px 0 10px;font-size:28px;font-style:italic;text-transform:uppercase}.prizes .hero-lot{display:flex;gap:12px;align-items:center}.prizes img{width:72px;height:72px;object-fit:cover;border:1px solid rgba(245,190,69,.3);border-radius:8px;background:#111}.prizes strong{display:block;font-size:22px}.prizes small{display:block;margin-top:4px;color:#cfc8b0;font-size:12px}.prizes ul{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:8px}.prizes li{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid #2a2620;background:rgba(0,0,0,.25);font-size:13px}.prizes .items{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}.prizes .items article{padding:10px;border:1px solid #2a2620;background:rgba(0,0,0,.22);text-align:center}.prizes .items img{width:100%;height:88px;object-fit:contain;margin-bottom:8px}.cta{position:fixed;left:50%;bottom:14px;z-index:5;width:min(calc(100% - 28px),732px);padding:15px;transform:translateX(-50%);border:0;border-radius:5px;background:linear-gradient(100deg,#d81831,#ff4459);color:#fff;font-size:12px;font-weight:900;letter-spacing:.08em;text-align:center;text-decoration:none;text-transform:uppercase;box-shadow:0 12px 35px rgba(238,36,60,.28)}
    .chat-fab{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:76px;z-index:20;display:flex;align-items:center;gap:8px;padding:13px 16px;border:1px solid rgba(255,100,120,.55);border-radius:99px;background:linear-gradient(120deg,#d81831,#ff5367);color:#fff;font-size:11px;font-weight:900;letter-spacing:.08em;box-shadow:0 12px 32px rgba(238,36,60,.4)}
    .chat-inline{width:100%;margin-top:14px;padding:13px;border:1px solid rgba(238,36,60,.42);border-radius:5px;background:linear-gradient(90deg,rgba(238,36,60,.18),rgba(238,36,60,.06));color:#ff8b9a;font-size:11px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
    .chat-backdrop{position:fixed;inset:0;z-index:50;display:none;justify-content:flex-end;background:rgba(0,0,0,.7);backdrop-filter:blur(7px)}.chat-backdrop.open{display:flex}
    .chat-panel{width:min(430px,100%);height:100%;display:grid;grid-template-rows:auto auto 1fr auto auto;border-left:1px solid rgba(238,36,60,.32);background:radial-gradient(circle at 100% 0,rgba(238,36,60,.16),transparent 35%),#09090d;box-shadow:-20px 0 60px rgba(0,0,0,.6)}
    .chat-head{padding:max(16px,env(safe-area-inset-top)) 16px 13px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #211d24}.chat-head span{display:block;color:#ff667a;font-size:8px;font-weight:900;letter-spacing:.2em}.chat-head strong{display:block;margin-top:3px;max-width:330px;overflow:hidden;font-style:italic;text-transform:uppercase;white-space:nowrap;text-overflow:ellipsis}.chat-head button{width:34px;height:34px;border:1px solid #342d35;border-radius:9px;background:#171319;color:#fff;font-size:21px}
    .chat-notice{padding:8px 12px;border-bottom:1px solid #211d24;background:rgba(238,36,60,.07);color:#827b85;font-size:9px;text-align:center}.chat-messages{min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:11px}.chat-state{margin:auto;color:#817a84;font-size:10px;text-align:center}.chat-message{display:grid;grid-template-columns:30px minmax(0,1fr);align-items:end;gap:8px}.chat-message.mine{grid-template-columns:minmax(0,1fr);justify-items:end;padding-left:42px}.chat-message.mine>.chat-avatar{display:none}.chat-avatar{width:30px;height:30px;display:grid;place-items:center;overflow:hidden;border:1px solid #383139;border-radius:50%;background:#211c23;color:#ddd;font-size:8px;font-weight:900}.chat-avatar img{width:100%;height:100%;object-fit:cover}.chat-bubble{max-width:88%;padding:8px 10px;border:1px solid #29242c;border-radius:5px 12px 12px;background:#151219}.mine .chat-bubble{border-color:rgba(238,36,60,.32);border-radius:12px 5px 12px 12px;background:rgba(238,36,60,.18)}.chat-meta{display:flex;gap:7px;margin-bottom:3px}.chat-meta b{color:#ff8393;font-size:9px}.chat-meta time{color:#665f68;font-size:8px}.chat-bubble p{margin:0;color:#e5e1e7;font-size:12px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.chat-photo{display:block;max-width:100%;max-height:250px;margin-bottom:6px;border-radius:7px;object-fit:cover}
    .chat-error{padding:7px 12px;background:rgba(238,36,60,.08);color:#ff7184;font-size:9px;text-align:center}.chat-login{margin:12px 14px max(14px,env(safe-area-inset-bottom));padding:13px;border:1px solid rgba(238,36,60,.45);border-radius:10px;background:rgba(238,36,60,.14);color:#ff91a0;font-size:10px;font-weight:900;letter-spacing:.08em;text-align:center;text-decoration:none;text-transform:uppercase}
    .chat-compose{padding:10px 12px max(12px,env(safe-area-inset-bottom));display:grid;grid-template-columns:36px 1fr 38px;gap:7px;border-top:1px solid #211d24}.chat-compose button{border:1px solid #322c34;border-radius:9px;background:#18141b;color:#fff}.chat-compose button:last-child{background:#d81c37}.chat-compose textarea{min-height:38px;max-height:90px;padding:10px;resize:none;border:1px solid #322c34;border-radius:9px;outline:none;background:#121015;color:#fff;font:12px Arial}.chat-compose input{display:none}
    @media(max-width:560px){.chat-fab{width:50px;height:50px;padding:0;justify-content:center;font-size:0}.chat-fab:before{content:"💬";font-size:19px}}
  </style>
</head>
<body>
  <main>
    <header class="top">
      <img class="logo" src="${escapeHtml(new URL('/assets/pictures/btf-logo-header.png', appUrl).toString())}" alt="BTF Arena" />
      <button class="share" id="share" type="button">PARTAGER</button>
    </header>
    <section class="hero">
      <span class="live" id="status"></span>
      <h1>${escapeHtml(competition.title)}</h1>
      <footer><div>TRADERS<strong id="participants">${competition.participants || leaderboard.length}</strong></div><div>TEMPS RESTANT<strong id="countdown">—</strong></div></footer>
    </section>
    ${prizeHtml}
    <button class="chat-inline" id="chat-open-inline" type="button">💬 OUVRIR LE CHAT DE L’ARÈNE</button>
    <section class="chart">
      <header class="section-head"><strong>COURSE AU PNL</strong><span>ACTUALISATION EN DIRECT</span></header>
      <canvas id="chart"></canvas>
    </section>
    <section class="ranking">
      <header class="section-head"><strong>CLASSEMENT</strong><span id="updated">LIVE</span></header>
      <div class="rows" id="rows"></div>
    </section>
    <button class="chat-fab" id="chat-open" type="button">💬 CHAT DE L’ARÈNE</button>
    <div class="chat-backdrop" id="chat-backdrop">
      <aside class="chat-panel" role="dialog" aria-label="Chat de l’arène">
        <header class="chat-head"><div><span>CHAT DE L’ARÈNE</span><strong>${escapeHtml(competition.title)}</strong></div><button id="chat-close" type="button">×</button></header>
        <div class="chat-notice">Participants et spectateurs échangent ici en direct.</div>
        <section class="chat-messages" id="chat-messages"><div class="chat-state">CHARGEMENT DU CHAT…</div></section>
        <div class="chat-error" id="chat-error" hidden></div>
        <div id="chat-footer"></div>
      </aside>
    </div>
    <a class="cta" href="${escapeHtml(appUrl)}">REJOINDRE LA PROCHAINE ARÈNE</a>
  </main>
  <script>
    const competitionId=${jsonForScript(competition.id)};
    let state=${initialData};
    let history=null;
    let historyCursor=0;
    let arenaSocketOpen=false;
    const money=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
    const esc=(value)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
    const chatToken=localStorage.getItem('btf-comp-session');
    let chatUser=null;try{chatUser=JSON.parse(localStorage.getItem('btf-comp-user')||'null')}catch{}
    let chatMessages=[],chatPhoto=null;
    function renderChat(){
      const box=document.getElementById('chat-messages');
      box.innerHTML=chatMessages.length?chatMessages.map(message=>{
        const mine=chatUser&&message.userId===chatUser.id;
        const avatar=message.avatarUrl?'<img src="'+esc(message.avatarUrl)+'" alt="">':esc(message.name.slice(0,2).toUpperCase());
        const photo=message.imageUrl?'<img class="chat-photo" src="'+esc(message.imageUrl)+'" alt="Photo partagée">':'';
        return '<article class="chat-message '+(mine?'mine':'')+'"><span class="chat-avatar">'+avatar+'</span><div class="chat-bubble"><div class="chat-meta"><b>'+esc(message.name)+'</b><time>'+new Date(message.createdAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</time></div>'+photo+(message.body?'<p>'+esc(message.body)+'</p>':'')+'</div></article>';
      }).join(''):'<div class="chat-state"><b>LE CHAT EST OUVERT</b><br>Sois le premier à lancer la discussion.</div>';
      box.scrollTop=box.scrollHeight;
    }
    function renderChatFooter(){
      const footer=document.getElementById('chat-footer');
      if(!chatToken||!chatUser){footer.innerHTML='<a class="chat-login" href="/compete#signup">CONNECTE-TOI POUR ÉCRIRE</a>';return}
      footer.innerHTML='<form class="chat-compose" id="chat-form"><button type="button" id="chat-attach">＋</button><input id="chat-file" type="file" accept="image/*"><textarea id="chat-body" maxlength="600" rows="1" placeholder="Écris un message…"></textarea><button type="submit">➤</button></form>';
      document.getElementById('chat-attach').onclick=()=>document.getElementById('chat-file').click();
      document.getElementById('chat-file').onchange=(event)=>{chatPhoto=event.target.files?.[0]||null};
      document.getElementById('chat-form').onsubmit=sendChat;
    }
    async function loadChat(){
      try{const result=await fetch('/api/competition/chat/messages?competitionId='+encodeURIComponent(competitionId));const payload=await result.json();if(!result.ok)throw new Error(payload.error||'Chat indisponible');chatMessages=payload.messages||[];renderChat()}catch(error){const node=document.getElementById('chat-error');node.hidden=false;node.textContent=error.message||'Chat indisponible'}
    }
    async function sendChat(event){
      event.preventDefault();const body=document.getElementById('chat-body').value.trim();if(!body&&!chatPhoto)return;
      try{let imageUrl;if(chatPhoto){const form=new FormData();form.append('image',chatPhoto);const upload=await fetch('/api/competition/chat/images',{method:'POST',headers:{Authorization:'Bearer '+chatToken},body:form});const uploaded=await upload.json();if(!upload.ok)throw new Error(uploaded.error||'Photo impossible');imageUrl=uploaded.imageUrl}
        const result=await fetch('/api/competition/chat/messages',{method:'POST',headers:{Authorization:'Bearer '+chatToken,'Content-Type':'application/json'},body:JSON.stringify({competitionId,body,imageUrl})});const payload=await result.json();if(!result.ok)throw new Error(payload.error||'Envoi impossible');document.getElementById('chat-body').value='';chatPhoto=null;await loadChat()
      }catch(error){const node=document.getElementById('chat-error');node.hidden=false;node.textContent=error.message||'Envoi impossible'}
    }
    function renderRows(){
      const rows=state.leaderboard||[];
      document.getElementById('participants').textContent=state.competition.participants||rows.length;
      document.getElementById('rows').innerHTML=rows.length?rows.map((row,index)=>{
        const avatar=row.avatarUrl?'<img src="'+esc(row.avatarUrl)+'" alt="">':'<i class="avatar">'+esc(row.name.slice(0,2).toUpperCase())+'</i>';
        const sign=row.pnlUsd>=0?'+':'';
        return '<article class="'+(index<3?'top3':'')+'"><b>#'+esc(row.rank)+'</b>'+avatar+'<div class="name">'+esc(row.name)+'<small>'+esc(row.tradesCount)+' trades</small></div><div class="pnl '+(row.pnlUsd>=0?'positive':'negative')+'">'+sign+money.format(row.pnlUsd)+' $<small style="display:block">'+(row.pnlPercent>=0?'+':'')+Number(row.pnlPercent).toFixed(2)+'%</small></div></article>';
      }).join(''):'<div class="empty">Le classement apparaîtra au lancement de l’arène.</div>';
      document.getElementById('updated').textContent='MIS À JOUR '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }
    function renderStatus(){
      const now=Date.now(),competition=state.competition;
      const live=competition.status==='live';
      document.getElementById('status').textContent=live?'EN DIRECT':'BTF ARENA';
      const target=live?competition.endAt:competition.startAt;
      const seconds=Math.max(0,Math.floor((target-now)/1000));
      const d=Math.floor(seconds/86400),h=Math.floor((seconds%86400)/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
      const pad=function(n){return String(n).padStart(2,'0')};
      document.getElementById('countdown').textContent=(d>0?d+'j ':'')+pad(h)+'h '+pad(m)+'m '+pad(s)+'s';
    }
    function drawChart(){
      const canvas=document.getElementById('chart'),rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
      canvas.width=Math.max(1,rect.width*dpr);canvas.height=250*dpr;
      const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=250;
      ctx.clearRect(0,0,w,h);ctx.strokeStyle='rgba(255,255,255,.06)';ctx.lineWidth=1;
      for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(0,h*i/5);ctx.lineTo(w,h*i/5);ctx.stroke()}
      const samples=history?.samples||[];const traders=(history?.traders||[]).slice(0,5);
      if(samples.length<2||!traders.length){ctx.fillStyle='#77717a';ctx.font='11px Arial';ctx.textAlign='center';ctx.fillText('COLLECTE DES DONNÉES LIVE…',w/2,h/2);return}
      const values=samples.flatMap(sample=>sample.rows.map(row=>row.pnlPercent));const min=Math.min(-1,...values),max=Math.max(1,...values),range=Math.max(1,max-min);
      const colors=['#ffd257','#cdd3db','#c07a40','#ee243c','#48a8ff'];
      traders.forEach((trader,index)=>{const points=samples.map((sample,si)=>{const row=sample.rows.find(item=>item.userId===trader.userId);return row?{x:si/(samples.length-1)*w,y:18+(max-row.pnlPercent)/range*(h-36)}:null}).filter(Boolean);if(points.length<2)return;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=colors[index];ctx.lineWidth=index===0?3:2;ctx.shadowColor=colors[index];ctx.shadowBlur=8;ctx.stroke();ctx.shadowBlur=0});
    }
    async function refresh(){
      try{
        const [leaderboardResult,historyResult]=await Promise.all([
          arenaSocketOpen?Promise.resolve(null):fetch('/api/competition/leaderboard/'+encodeURIComponent(competitionId)).then(r=>r.json()),
          fetch('/api/competition/leaderboard/'+encodeURIComponent(competitionId)+'/pnl-history'+(historyCursor?'?after='+encodeURIComponent(historyCursor):'')).then(r=>r.json())
        ]);
        if(leaderboardResult?.competition){state=leaderboardResult;renderRows();renderStatus()}
        if(historyResult){
          const incoming=historyResult.samples||[];
          const samples=history?[...(history.samples||[]),...incoming]:incoming;
          const unique=[...new Map(samples.map(sample=>[sample.t,sample])).values()].sort((a,b)=>a.t-b.t);
          history={...history,...historyResult,samples:unique,traders:historyResult.traders||history?.traders||[]};
          historyCursor=Number(historyResult.cursor)||historyCursor;
          drawChart()
        }
      }catch{}
    }
    function applyArenaPatch(patch){
      if(!patch||patch.competitionId!==competitionId)return;
      const rows=new Map((state.leaderboard||[]).map(row=>[row.userId,row]));
      (patch.removed||[]).forEach(userId=>rows.delete(userId));
      (patch.upserts||[]).forEach(update=>{if(update?.userId)rows.set(update.userId,{...(rows.get(update.userId)||{}),...update})});
      state={...state,competition:patch.competition||state.competition,leaderboard:[...rows.values()].sort((a,b)=>(a.rank||0)-(b.rank||0)||(b.pnlPercent||0)-(a.pnlPercent||0))};
      renderRows();renderStatus()
    }
    function connectArena(){
      const protocol=location.protocol==='https:'?'wss:':'ws:';
      const socket=new WebSocket(protocol+'//'+location.host+'/ws?arenaId='+encodeURIComponent(competitionId));
      socket.onopen=()=>{arenaSocketOpen=true};
      socket.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.type==='arena:init'&&message.data){state={...state,...message.data};renderRows();renderStatus()}else if(message.type==='arena:patch')applyArenaPatch(message.data)}catch{}};
      socket.onclose=()=>{arenaSocketOpen=false;setTimeout(connectArena,1000)};
      socket.onerror=()=>socket.close()
    }
    document.getElementById('share').onclick=async()=>{const data={title:document.title,text:'Regarde cette arène BTF en direct',url:location.href};try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(location.href);document.getElementById('share').textContent='LIEN COPIÉ'}}catch{}};
    const openChat=()=>{document.getElementById('chat-backdrop').classList.add('open');loadChat()};
    document.getElementById('chat-open').onclick=openChat;
    document.getElementById('chat-open-inline').onclick=openChat;
    document.getElementById('chat-close').onclick=()=>document.getElementById('chat-backdrop').classList.remove('open');
    document.getElementById('chat-backdrop').onclick=(event)=>{if(event.target.id==='chat-backdrop')event.currentTarget.classList.remove('open')};
    renderChatFooter();renderRows();renderStatus();connectArena();refresh();setInterval(renderStatus,1000);setInterval(refresh,10000);setInterval(()=>{if(document.getElementById('chat-backdrop').classList.contains('open'))loadChat()},5000);addEventListener('resize',drawChart);
  </script>
</body>
</html>`;
}
