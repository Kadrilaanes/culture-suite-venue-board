(function(){
  "use strict";

  var STAGES = [
    {k:"identified",  n:"Identified",  p:0.05, c:"#8E8397", bg:"rgba(142,131,151,.12)"},
    {k:"contacted",   n:"Contacted",   p:0.10, c:"#6C7FA8", bg:"rgba(108,127,168,.14)"},
    {k:"discovery",   n:"Discovery",   p:0.25, c:"#4E8FA6", bg:"rgba(78,143,166,.14)"},
    {k:"demo",        n:"Demo",        p:0.40, c:"#3F927F", bg:"rgba(63,146,127,.14)"},
    {k:"proposal",    n:"Proposal",    p:0.60, c:"#A87A3C", bg:"rgba(168,122,60,.14)"},
    {k:"contracting", n:"Contracting", p:0.80, c:"#B4652E", bg:"rgba(180,101,46,.14)"},
    {k:"won",         n:"Won",         p:1.00, c:"#2C7A5B", bg:"rgba(44,122,91,.16)"},
    {k:"nurture",     n:"Nurture",     p:0.05, c:"#7A7080", bg:"rgba(122,112,128,.12)"},
    {k:"lost",        n:"Lost",        p:0.00, c:"#A93A2C", bg:"rgba(169,58,44,.12)"}
  ];
  var STAGEMAP = {}; STAGES.forEach(function(s){ STAGEMAP[s.k]=s; });
  var LIVE = {contacted:1, discovery:1, demo:1, proposal:1, contracting:1};
  var TIERVAL = {flagship:18000, mid:11000, small:6500};
  var TIERN = {flagship:"Flagship", mid:"Mid-scale", small:"Small"};

  var MAPS = null;
  var MAPMETA = {europe:{n:"Europe"}, na:{n:"North America"}};



  var state = {schema:2, updatedAt:null, venues:[], signals:[]};
  var ui = {view:"venues", q:"", seg:"", reg:"", stage:"", sort:"stage", open:{}, terr:{}, map:"europe", sel:null};
  var api = null, saveTimer = null, readOnly = false, filesOK = true;

  var $ = function(s){ return document.querySelector(s); };
  var esc = function(s){
    return String(s==null?"":s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  };
  var money = function(n){ n=Number(n)||0; return n>=1000 ? "£"+Math.round(n/100)/10+"k" : "£"+n; };
  var moneyFull = function(n){ return "£"+(Number(n)||0).toLocaleString("en-GB"); };
  var today = function(){ return new Date().toISOString().slice(0,10); };

  /* ---------- persistence ---------- */
  var LS = "cs-venue-board-v1";
  function setChip(s, t){ var c=$("#savechip"); c.dataset.state=s; c.textContent=t; }
  function mirrorLocal(){ try{ localStorage.setItem(LS, JSON.stringify(state)); }catch(e){} }

  function save(){
    state.updatedAt = new Date().toISOString();
    mirrorLocal();
    if (readOnly) return;
    if (!api || !filesOK){ setChip("local","Saved on this device"); return; }
    clearTimeout(saveTimer);
    setChip("saving","Saving…");
    saveTimer = setTimeout(function(){
      api.publish({"data/board.json": JSON.stringify(state, null, 1)}).then(function(){
        setChip("saved","Saved to board");
      }).catch(function(err){
        var code = err && err.code;
        if (code === "conflict") return;
        if (code === "not_writer" || code === "not_granted"){
          readOnly = true; document.body.dataset.ro = "1"; setChip("idle","Read-only"); return;
        }
        if (code === "rate_limited"){ setChip("saving","Slowing down…"); return; }
        filesOK = false; setChip("local","Saved on this device");
      });
    }, 1400);
  }

  // Data lives in ./data/*.json so it can be regenerated or replaced wholesale.
  function getJSON(url){
    // The single-file build in dist/ preloads these instead of fetching them.
    var pre = window.__VENUE_BOARD_DATA;
    if (pre && Object.prototype.hasOwnProperty.call(pre, url)) return Promise.resolve(pre[url]);
    return fetch(url, {cache:"no-store"}).then(function(r){
      if (!r.ok) throw new Error(url+" -> "+r.status);
      return r.json();
    });
  }

  function boot(){
    render();
    Promise.all([
      getJSON("data/maps.json").catch(function(){ return null; }),
      getJSON("data/seed-venues.json").catch(function(){ return null; })
    ]).then(function(res){
      if (res[0]) MAPS = res[0];
      if (res[1] && Array.isArray(res[1].venues)){
        state.venues = res[1].venues.map(function(v){ return Object.assign({}, v); });
      }
      // Anything saved by a previous session wins over the shipped seed.
      return getJSON("data/board.json").then(function(saved){
        if (saved && Array.isArray(saved.venues)){
          if (!saved.signals) saved.signals = [];
          state = saved;
        }
      }).catch(function(){
        try{
          var raw = localStorage.getItem(LS);
          if (raw){
            var j = JSON.parse(raw);
            if (j && Array.isArray(j.venues)){ if(!j.signals) j.signals=[]; state = j; }
          }
        }catch(e){}
      });
    }).then(function(){
      render();
      setChip("idle", state.updatedAt ? "Up to date" : "Starter list");
    });

    // Optional: when hosted as a Claude Artifact the board can save new versions
    // of itself. Everywhere else this is a no-op and edits go to localStorage.
    if (window.claude && window.claude.use){
      window.claude.use("artifact").then(function(a){ api=a; if(!a) setChip("local","Saves on this device"); });
      window.claude.use("downloads").then(function(d){
        if (!d) return;
        var b=$("#csv"); b.hidden=false;
        b.addEventListener("click", function(){ d.save({filename:"culture-suite-venue-board.csv", data:toCSV()}); });
      });
    } else {
      setChip("local","Saves on this device");
      var b=$("#csv"); b.hidden=false;
      b.addEventListener("click", downloadCSV);
    }
  }

  function downloadCSV(){
    var blob = new Blob([toCSV()], {type:"text/csv;charset=utf-8"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "culture-suite-venue-board.csv";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function toCSV(){
    var cols=["name","city","country","region","cls","segment","tier","value","stage","owner","nextStep","due","lastTouch","notes"];
    var head=["Venue","City","Country","Region","Class","Segment","Scale","Annual licence (GBP)","Stage","Owner","Next step","Due","Last touch","Notes"];
    var lines=[head.join(",")];
    state.venues.forEach(function(x){
      lines.push(cols.map(function(c){
        var val = x[c]==null ? "" : String(x[c]);
        if (c==="stage") val = STAGEMAP[x.stage] ? STAGEMAP[x.stage].n : x.stage;
        if (c==="segment") val = x.segment==="client" ? "Existing client" : "Net-new prospect";
        if (c==="tier") val = TIERN[x.tier]||x.tier;
        return /[",\n]/.test(val) ? '"'+val.replace(/"/g,'""')+'"' : val;
      }).join(","));
    });
    return lines.join("\n");
  }

  /* ---------- derive ---------- */
  function regions(){
    var seen={}, out=[];
    state.venues.forEach(function(x){ if(!seen[x.region]){seen[x.region]=1;out.push(x.region);} });
    return out.sort();
  }
  function find(id){
    for (var i=0;i<state.venues.length;i++) if (state.venues[i].id===id) return state.venues[i];
    return null;
  }
  function weighted(x){
    var s = STAGEMAP[x.stage]||STAGES[0];
    return (Number(x.value)||0) * s.p;
  }
  function daysSince(d){
    if (!d) return null;
    var t = Date.parse(d); if (isNaN(t)) return null;
    return Math.floor((Date.now()-t)/86400000);
  }

  function score(x){
    var pts = 0, why = [];
    if (x.tier==="flagship"){ pts+=3; why.push("Flagship scale"); }
    else if (x.tier==="mid"){ pts+=2; }
    else { pts+=1; }
    if (x.segment==="client"){ pts+=3; why.push("Already a client"); }
    if (LIVE[x.stage]){ pts+=2; why.push("Live conversation"); }
    if (x.stage==="won"||x.stage==="lost") pts-=99;
    var d = daysSince(x.lastTouch);
    if (d!==null && d>45){ pts+=1; why.push("Gone quiet — "+d+"d"); }
    if (x.due && x.due <= today()){ pts+=2; why.push("Next step due"); }
    if (x.pin){ pts+=100; why.push("Pinned"); }
    if (peer(x)) why.push("Peer proof nearby");
    return {pts:pts, why:why};
  }

  function peer(x){
    var best = null;
    state.venues.forEach(function(y){
      if (y.segment!=="client" || y.id===x.id) return;
      if (y.region!==x.region) return;
      if (!best) best = y;
      else if (y.cls===x.cls && best.cls!==x.cls) best = y;
      else if (y.country===x.country && best.country!==x.country) best = y;
    });
    return best;
  }

  function draft(x){
    var p = peer(x);
    var cls = (x.cls||"venue").toLowerCase();
    if (x.segment === "client"){
      return "Hi [name],\n\n" +
        x.name + " has been running on Culture Suite for a while now, and the website licence is the piece you don't have yet.\n\n" +
        "It's the same subscription shape as the rest: hosting, security, training and support included, unlimited team accounts, and every new feature we build for one venue ships to all of you at no extra cost. No rebuild project, no retainer.\n\n" +
        "Worth twenty minutes to walk you through what it would look like on your side?\n\n[you]";
    }
    return "Hi [name],\n\n" +
      "Most " + cls + "s I speak to rebuild their website every three or four years, budget it as a capital project, and start the clock again the day it launches.\n\n" +
      "Culture Suite is the other model — a website licence, built only for ticketed cultural organisations. Hosting, security, training and support are in the subscription, team accounts are unlimited, and new features ship to everyone rather than being quoted as change requests. Over 120 cultural organisations run on it" +
      (p ? ", including " + p.name + (p.city && p.city !== x.city ? " in " + p.city : "") : "") + ".\n\n" +
      "Is a short look at it worth your time" + (x.city ? "" : "") + "?\n\n[you]";
  }

  function visible(onlyLive){
    var q = ui.q.trim().toLowerCase();
    var list = state.venues.filter(function(x){
      if (onlyLive && !LIVE[x.stage]) return false;
      if (ui.seg && x.segment !== ui.seg) return false;
      if (ui.reg && x.region !== ui.reg) return false;
      if (ui.stage && x.stage !== ui.stage) return false;
      if (q){
        var hay=[x.name,x.city,x.country,x.cls,x.owner,x.notes,x.nextStep].join(" ").toLowerCase();
        if (hay.indexOf(q)===-1) return false;
      }
      return true;
    });
    var order={}; STAGES.forEach(function(s,i){ order[s.k]=i; });
    list.sort(function(a,b){
      if (ui.sort==="value") return (b.value||0)-(a.value||0) || a.name.localeCompare(b.name);
      if (ui.sort==="name")  return a.name.localeCompare(b.name);
      if (ui.sort==="due"){
        var ad=a.due||"9999-99-99", bd=b.due||"9999-99-99";
        return ad.localeCompare(bd) || a.name.localeCompare(b.name);
      }
      return (order[b.stage]||0)-(order[a.stage]||0) || (b.value||0)-(a.value||0);
    });
    return list;
  }

  /* ---------- shared pieces ---------- */
  function kpi(lab,val,note,isMoney){
    return '<div class="kpi"><span class="lab">'+esc(lab)+'</span>'+
      '<span class="val'+(isMoney?" money":"")+'">'+esc(val)+'</span>'+
      '<span class="note">'+esc(note)+'</span></div>';
  }

  function funnelHTML(){
    var counts={};
    state.venues.forEach(function(x){ counts[x.stage]=(counts[x.stage]||0)+1; });
    var bar="", key="";
    STAGES.forEach(function(s){
      var n=counts[s.k]||0;
      if (n) bar+='<span style="flex:'+n+' 1 0;background:'+s.c+'" title="'+s.n+': '+n+'"></span>';
      key+='<button type="button" data-stage="'+s.k+'" aria-pressed="'+(ui.stage===s.k)+'"><i class="dot" style="background:'+s.c+'"></i>'+s.n+' '+n+'</button>';
    });
    return '<section class="funnel"><div class="funnel-bar">'+(bar||'<span style="flex:1;background:var(--line-2)"></span>')+'</div>'+
      '<div class="funnel-key" id="funnelkey">'+key+'</div></section>';
  }

  function controlsHTML(){
    return '<section class="controls">'+
      '<div class="search">'+
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'+
        '<input id="q" type="search" placeholder="Search venue, city, owner, notes" aria-label="Search venues" value="'+esc(ui.q)+'">'+
      '</div>'+
      '<select id="fseg" aria-label="Filter by segment">'+
        opt("", "All segments", ui.seg)+opt("client","Existing client · upsell",ui.seg)+opt("prospect","Net-new prospect",ui.seg)+
      '</select>'+
      '<select id="freg" aria-label="Filter by region">'+
        opt("","All regions",ui.reg)+regions().map(function(r){return opt(r,r,ui.reg);}).join("")+
      '</select>'+
      '<select id="fstage" aria-label="Filter by stage">'+
        opt("","All stages",ui.stage)+STAGES.map(function(s){return opt(s.k,s.n,ui.stage);}).join("")+
      '</select>'+
      '<select id="sort" aria-label="Sort by">'+
        opt("stage","Sort: pipeline stage",ui.sort)+opt("value","Sort: licence value",ui.sort)+
        opt("due","Sort: next step due",ui.sort)+opt("name","Sort: venue name",ui.sort)+
      '</select>'+
    '</section>';
  }
  function opt(val,lab,cur){ return '<option value="'+esc(val)+'"'+(val===cur?" selected":"")+'>'+esc(lab)+'</option>'; }

  function rowsHTML(list){
    if (!list.length) return '<div class="empty">No venues match these filters. Clear the search or pick a different segment.</div>';
    return '<ul class="rows">'+list.map(function(x){
      var s=STAGEMAP[x.stage]||STAGES[0];
      var open=!!ui.open[x.id];
      var meta=[x.cls, x.city+", "+x.country, x.region].join(" · ");
      var w=weighted(x);
      return '<li class="row'+(open?" open":"")+'" style="--stage-c:'+s.c+';--stage-bg:'+s.bg+'" data-id="'+esc(x.id)+'">'+
        '<button class="rowhead" type="button" data-act="toggle" aria-expanded="'+open+'">'+
          '<span class="vname">'+esc(x.name)+' <span class="seg '+(x.segment==="client"?"client":"")+'">'+(x.segment==="client"?"Client":"New")+'</span></span>'+
          '<span class="vmeta">'+esc(meta)+(x.nextStep?" · next: "+esc(x.nextStep):"")+'</span>'+
          '<span class="rowright">'+
            '<span class="val-cell"><b>'+esc(money(x.value))+'</b><span>'+esc(money(w))+' wtd</span></span>'+
            '<span class="stage-pill">'+esc(s.n)+'</span>'+
          '</span>'+
        '</button>'+
        (open?detailHTML(x,s,w):"")+
      '</li>';
    }).join("")+'</ul>';
  }

  function detailHTML(x,s,w){
    return '<div class="detail">'+
      '<div class="fgrid">'+
        field("Venue", '<input type="text" data-f="name" value="'+esc(x.name)+'">')+
        field("Segment", '<select data-f="segment">'+
          '<option value="prospect"'+(x.segment!=="client"?" selected":"")+'>Net-new prospect</option>'+
          '<option value="client"'+(x.segment==="client"?" selected":"")+'>Existing client · upsell</option></select>')+
        field("Class", '<input type="text" data-f="cls" value="'+esc(x.cls)+'" placeholder="Theatre, museum…">')+
        field("Scale", '<select data-f="tier">'+
          ["flagship","mid","small"].map(function(t){
            return '<option value="'+t+'"'+(x.tier===t?" selected":"")+'>'+TIERN[t]+'</option>';
          }).join("")+'</select>')+
        field("City", '<input type="text" data-f="city" value="'+esc(x.city)+'">')+
        field("Country", '<input type="text" data-f="country" value="'+esc(x.country)+'" placeholder="UK">')+
        field("Region", '<input type="text" data-f="region" value="'+esc(x.region)+'" list="regionlist">')+
        field("Stage", '<select data-f="stage">'+STAGES.map(function(st){
          return '<option value="'+st.k+'"'+(st.k===x.stage?" selected":"")+'>'+st.n+'</option>';
        }).join("")+'</select>')+
        field("Annual licence (£)", '<input type="number" min="0" step="500" data-f="value" value="'+esc(x.value)+'">')+
        field("Owner", '<input type="text" data-f="owner" value="'+esc(x.owner)+'" placeholder="Who owns this?">')+
        field("Next step", '<input type="text" data-f="nextStep" value="'+esc(x.nextStep)+'" placeholder="e.g. Send platform demo link">')+
        field("Due", '<input type="date" data-f="due" value="'+esc(x.due)+'">')+
        field("Last touch", '<input type="date" data-f="lastTouch" value="'+esc(x.lastTouch)+'">')+
        field("Latitude", '<input type="number" step="0.01" data-f="lat" value="'+esc(x.lat==null?"":x.lat)+'" placeholder="51.51">')+
        field("Longitude", '<input type="number" step="0.01" data-f="lon" value="'+esc(x.lon==null?"":x.lon)+'" placeholder="-0.13">')+
      '</div>'+
      field("Notes", '<textarea data-f="notes" placeholder="Current site, renewal window, who we know there, objections…">'+esc(x.notes)+'</textarea>')+
      '<div class="detail-foot">'+
        '<span class="weighted">'+esc(s.n)+' · '+Math.round(s.p*100)+'% → weighted <b>'+esc(moneyFull(Math.round(w)))+'</b></span>'+
        '<button class="del" type="button" data-act="delete">Remove venue</button>'+
      '</div>'+
    '</div>';
  }
  function field(lab,inner){ return '<div class="field"><label>'+esc(lab)+'</label>'+inner+'</div>'; }

  /* ---------- views ---------- */
  function viewVenues(){
    var t={count:state.venues.length, clients:0, open:0, wtd:0, live:0};
    state.venues.forEach(function(x){
      if (x.segment==="client") t.clients++;
      if (x.stage==="won"||x.stage==="lost") return;
      t.open += Number(x.value)||0;
      t.wtd += weighted(x);
      if (LIVE[x.stage]) t.live++;
    });
    var list = visible(false);
    var listed = list.reduce(function(a,x){ return a+(Number(x.value)||0); },0);
    return '<section class="kpis">'+
        kpi("Venues tracked", t.count, t.clients+" existing clients · "+(t.count-t.clients)+" net-new")+
        kpi("Live conversations", t.live, "past first contact, not yet closed")+
        kpi("Open licence value", money(t.open), "annual, unweighted", true)+
        kpi("Weighted forecast", money(t.wtd), "open value × stage probability", true)+
      '</section>'+
      funnelHTML()+controlsHTML()+
      '<p class="countline">'+list.length+(list.length===1?" venue":" venues")+' · '+moneyFull(listed)+' listed</p>'+
      rowsHTML(list);
  }

  function viewLeads(){
    var live = state.venues.filter(function(x){ return LIVE[x.stage]; });
    var wtd = live.reduce(function(a,x){ return a+weighted(x); },0);
    var gross = live.reduce(function(a,x){ return a+(Number(x.value)||0); },0);
    var overdue = live.filter(function(x){ return x.due && x.due <= today(); }).length;
    var stale = live.filter(function(x){ var d=daysSince(x.lastTouch); return d===null || d>30; }).length;
    var list = visible(true);
    if (!live.length){
      return '<div class="empty" style="margin-top:26px"><b>No live conversations yet</b>'+
        'A venue lands here the moment you move it past Identified. Open any venue on the Venues tab and set its stage to Contacted.</div>';
    }
    return '<section class="kpis">'+
        kpi("Open leads", live.length, "stage Contacted through Contracting")+
        kpi("Weighted forecast", money(wtd), "of "+money(gross)+" gross", true)+
        kpi("Next steps overdue", overdue, overdue?"due today or earlier":"nothing slipping")+
        kpi("Gone quiet", stale, "no touch logged in 30 days")+
      '</section>'+
      controlsHTML()+
      '<p class="countline">'+list.length+' of '+live.length+' live leads shown</p>'+
      rowsHTML(list);
  }

  function viewPriority(){
    var ranked = state.venues.map(function(x){
      var s = score(x);
      return {x:x, pts:s.pts, why:s.why};
    }).filter(function(r){ return r.pts > -50; })
      .sort(function(a,b){ return b.pts-a.pts || (b.x.value||0)-(a.x.value||0); })
      .slice(0,15);

    return '<p class="lede">The fifteen venues to move next, ranked by scale, warmth and whether something is already slipping. Pin anything you want held at the top. Each card carries a first-contact draft you can edit — it saves with the board.</p>'+
      '<div class="sectionhead">Priority board · top 15</div>'+
      '<ul class="pcards">'+ranked.map(function(r,i){
        var x=r.x, s=STAGEMAP[x.stage]||STAGES[0];
        var msg = x.msg || draft(x);
        return '<li class="pcard'+(x.pin?" pinned":"")+'" data-id="'+esc(x.id)+'">'+
          '<div class="prank"><span>'+String(i+1).padStart(2,"0")+' · '+esc(s.n)+'</span>'+
            '<span class="score">'+esc(money(x.value))+' · score '+r.pts+'</span></div>'+
          '<div class="pname">'+esc(x.name)+'</div>'+
          '<div class="pwhy">'+
            '<span class="tag">'+esc(x.cls)+'</span>'+
            '<span class="tag">'+esc(x.city)+'</span>'+
            r.why.map(function(w){ return '<span class="tag">'+esc(w)+'</span>'; }).join("")+
          '</div>'+
          '<textarea class="pmsg" data-f="msg" aria-label="Draft message for '+esc(x.name)+'">'+esc(msg)+'</textarea>'+
          '<div class="pfoot">'+
            '<button class="btn mini" type="button" data-act="copy">Copy draft</button>'+
            '<button class="btn mini" type="button" data-act="redraft">Reset draft</button>'+
            '<button class="pin" type="button" data-act="pin">'+(x.pin?"Unpin":"Pin to top")+'</button>'+
          '</div>'+
        '</li>';
      }).join("")+'</ul>';
  }

  function viewIntel(){
    var kinds = [["signal","Signal"],["touch","Touch"],["risk","Risk"],["note","Note"]];
    var form = '<form class="feedform" id="feedform">'+
      field("Date", '<input type="date" name="date" value="'+today()+'" required>')+
      field("Venue", '<select name="venue">'+state.venues.slice().sort(function(a,b){return a.name.localeCompare(b.name);})
        .map(function(x){ return '<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>'; }).join("")+'</select>')+
      field("Kind", '<select name="kind">'+kinds.map(function(k){ return '<option value="'+k[0]+'">'+k[1]+'</option>'; }).join("")+'</select>')+
      field("What happened", '<input type="text" name="text" placeholder="Redevelopment announced, new marketing lead, RFP out…" required>')+
      '<div class="field"><label>&nbsp;</label><button class="btn primary" type="submit">Log it</button></div>'+
    '</form>';

    var items = state.signals.slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||"") || b.id-a.id; });
    var body;
    if (!items.length){
      body = '<div class="empty"><b>Nothing logged yet</b>'+
        'This is the running record of what you hear about these venues — a redevelopment, a new marketing director, a website RFP, a funding cut, a call that went well. Log one above and it threads onto the venue.</div>';
    } else {
      body = '<ul class="feed">'+items.map(function(sg){
        var x = find(sg.venue);
        return '<li class="feeditem" data-sid="'+sg.id+'">'+
          '<span class="feeddate">'+esc(sg.date||"")+'</span>'+
          '<span class="feedbody"><b>'+esc(x?x.name:"Unknown venue")+'</b>'+
            '<p><span class="kind" data-k="'+esc(sg.kind)+'">'+esc(sg.kind)+'</span>'+esc(sg.text)+'</p></span>'+
          '<button class="del" type="button" data-act="unlog">Remove</button>'+
        '</li>';
      }).join("")+'</ul>';
    }
    return '<p class="lede">A manual intel log — a published page can\'t pull news on its own. Entries here are yours; ask me for a sweep and I\'ll research the venues and fill it.</p>'+
      '<div class="sectionhead">Log an entry</div>'+form+
      '<div class="sectionhead">Feed</div>'+body;
  }

  /* ---------- map ---------- */
  function project(m, lat, lon){
    if (lat==null || lon==null || isNaN(lat) || isNaN(lon)) return null;
    var rad = Math.PI/180;
    var x = (lon*rad - m.x0) * m.k;
    var y = (m.y1 - Math.log(Math.tan(Math.PI/4 + lat*rad/2))) * m.k;
    if (x < -20 || x > m.w+20 || y < -20 || y > m.h+20) return null;
    return [x, y];
  }
  function mapOf(x){
    if (!MAPS) return null;
    if (x.lat==null || x.lon==null) return null;
    if (project(MAPS.europe, x.lat, x.lon)) return "europe";
    if (project(MAPS.na, x.lat, x.lon)) return "na";
    return null;
  }
  function radius(t){ return t==="flagship" ? 7 : t==="mid" ? 5.5 : 4.5; }

  function mapHTML(){
    if (!MAPS) return "";
    var placed = {europe:[], na:[]}, offmap = [];
    state.venues.forEach(function(x){
      var k = mapOf(x);
      if (k) placed[k].push(x); else offmap.push(x);
    });
    var keys = Object.keys(placed).filter(function(k){ return placed[k].length; });
    if (!keys.length) return "";
    if (keys.indexOf(ui.map) === -1) ui.map = keys[0];
    var m = MAPS[ui.map];
    var here = placed[ui.map];

    var withVenue = {};
    here.forEach(function(x){ withVenue[x.country] = 1; });

    var land = m.feats.map(function(f){
      return '<path d="'+f.d+'" class="cty'+(f.n && withVenue[f.n] ? " on" : "")+'"/>';
    }).join("");

    // Venues in the same town land on the same point — fan them out so each is clickable.
    var at = {}, pos = {};
    here.forEach(function(x){
      var p = project(m, x.lat, x.lon);
      var key = Math.round(p[0]/7)+","+Math.round(p[1]/7);
      (at[key] || (at[key]=[])).push({x:x, p:p});
    });
    Object.keys(at).forEach(function(key){
      var grp = at[key];
      if (grp.length === 1){ pos[grp[0].x.id] = grp[0].p; return; }
      var spread = 6 + grp.length * 1.6;
      grp.forEach(function(g, i){
        var a = -Math.PI/2 + i * 2*Math.PI/grp.length;
        pos[g.x.id] = [g.p[0] + Math.cos(a)*spread, g.p[1] + Math.sin(a)*spread];
      });
    });
    var taken = {};
    here.forEach(function(x){
      var p = pos[x.id], guard = 0;
      while (taken[Math.round(p[0])+","+Math.round(p[1])] && guard++ < 20){
        p = [p[0] + 5, p[1] - 5];
      }
      taken[Math.round(p[0])+","+Math.round(p[1])] = 1;
      pos[x.id] = p;
    });

    var order = here.slice().sort(function(a,b){ return radius(b.tier)-radius(a.tier); });
    var pins = order.map(function(x){
      var p = pos[x.id];
      var s = STAGEMAP[x.stage]||STAGES[0];
      var sel = ui.sel===x.id;
      return '<g class="pin'+(x.segment==="client"?" client":"")+(sel?" sel":"")+'" data-pin="'+esc(x.id)+'" '+
        'transform="translate('+Math.round(p[0])+','+Math.round(p[1])+')" tabindex="0" role="button" '+
        'aria-label="'+esc(x.name+", "+x.city+" — "+s.n)+'">'+
        '<circle class="halo" r="'+(radius(x.tier)+7)+'"/>'+
        '<circle class="dot" r="'+radius(x.tier)+'"/>'+
        '</g>';
    }).join("");

    var switcher = keys.length>1 ? '<div class="mapswitch">'+keys.map(function(k){
      return '<button type="button" class="btn mini" data-map="'+k+'" aria-pressed="'+(ui.map===k)+'">'+
        esc(MAPMETA[k].n)+' <span class="n">'+placed[k].length+'</span></button>';
    }).join("")+'</div>' : "";

    var sel = ui.sel ? find(ui.sel) : null;
    var callout = "";
    if (sel){
      var st = STAGEMAP[sel.stage]||STAGES[0];
      callout = '<div class="callout" style="--stage-c:'+st.c+'">'+
        '<div><b>'+esc(sel.name)+'</b><span>'+esc(sel.cls+" · "+sel.city+", "+sel.country)+'</span></div>'+
        '<div class="callout-r"><span class="stage-pill" style="--stage-bg:'+st.bg+'">'+esc(st.n)+'</span>'+
        '<b class="cmoney">'+esc(money(sel.value))+'</b></div></div>';
    }

    var cap = Math.round(560 * m.w / m.h);
    return '<div class="maphead">'+switcher+
      '<div class="maplegend">'+
        '<span><i class="lg client"></i>Existing client</span>'+
        '<span><i class="lg"></i>Net-new prospect</span>'+
        '<span class="lgsize">Dot size = venue scale</span>'+
      '</div></div>'+
      '<div class="mapbox" style="max-width:min(100%,'+cap+'px)"><svg class="map" viewBox="0 0 '+m.w+' '+m.h+'" role="img" '+
        'aria-label="Venue locations across '+esc(MAPMETA[ui.map].n)+'">'+
        '<g class="land">'+land+'</g><g class="pins">'+pins+'</g></svg></div>'+
      callout+
      (offmap.length ? '<p class="offmap">'+offmap.length+' venue'+(offmap.length===1?"":"s")+
        ' not on the map yet — add a latitude and longitude on the venue to place '+(offmap.length===1?"it":"them")+'.</p>' : "");
  }

  function viewTerritory(){
    var byRegion = {};
    state.venues.forEach(function(x){
      var r = byRegion[x.region] || (byRegion[x.region] = {n:0, clients:0, value:0, countries:{}});
      r.n++; if (x.segment==="client") r.clients++;
      if (x.stage!=="lost") r.value += Number(x.value)||0;
      (r.countries[x.country] || (r.countries[x.country]=[])).push(x);
    });
    var names = Object.keys(byRegion).sort(function(a,b){ return byRegion[b].n - byRegion[a].n; });
    return '<p class="lede">Coverage by territory — where the licence base already is, and where the white space sits. Tap a dot for the venue, or open a region below to drill into its countries.</p>'+
      '<div class="sectionhead">Map</div>'+
      mapHTML()+
      '<div class="sectionhead">Territory · '+names.length+' regions</div>'+
      '<ul class="terr">'+names.map(function(rn){
        var r = byRegion[rn], open = !!ui.terr[rn];
        var pct = r.n ? Math.round(r.clients/r.n*100) : 0;
        return '<li class="tgroup" data-terr="'+esc(rn)+'">'+
          '<button class="thead" type="button" data-act="terr" aria-expanded="'+open+'">'+
            '<span class="tname">'+esc(rn)+'</span>'+
            '<span class="tstats"><span>'+r.n+' venues</span><span>'+r.clients+' clients ('+pct+'%)</span><b>'+esc(money(r.value))+'</b></span>'+
          '</button>'+
          '<div class="tmeter"><span style="flex:'+r.clients+';background:var(--accent)"></span><span style="flex:'+(r.n-r.clients)+';background:var(--line-2)"></span></div>'+
          (open ? '<div class="tbody">'+Object.keys(r.countries).sort().map(function(c){
            return '<div class="tcountry"><h4>'+esc(c)+' · '+r.countries[c].length+'</h4><ul class="tlist">'+
              r.countries[c].slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(x){
                return '<li data-seg="'+esc(x.segment)+'">'+esc(x.name)+'</li>';
              }).join("")+'</ul></div>';
          }).join("")+'</div>' : "")+
        '</li>';
      }).join("")+'</ul>';
  }

  /* ---------- shell ---------- */
  var VIEWS = [
    {k:"venues",   n:"Venues",         f:viewVenues,    count:function(){ return state.venues.length; }},
    {k:"leads",    n:"Leads",          f:viewLeads,     count:function(){ return state.venues.filter(function(x){return LIVE[x.stage];}).length; }},
    {k:"priority", n:"Priority Board", f:viewPriority,  count:function(){ return Math.min(15, state.venues.length); }},
    {k:"intel",    n:"Intel Feed",     f:viewIntel,     count:function(){ return state.signals.length; }},
    {k:"territory",n:"Territory",      f:viewTerritory, count:function(){
      var s={}; state.venues.forEach(function(x){ s[x.region]=1; }); return Object.keys(s).length; }}
  ];

  function renderTabs(){
    $("#tabs").innerHTML = VIEWS.map(function(v){
      return '<button type="button" role="tab" data-view="'+v.k+'" aria-selected="'+(ui.view===v.k)+'">'+
        v.n+' <span class="n">'+v.count()+'</span></button>';
    }).join("");
  }
  function render(){
    renderTabs();
    var v = VIEWS.filter(function(z){ return z.k===ui.view; })[0] || VIEWS[0];
    $("#view").innerHTML = v.f();
    $("#regionlist").innerHTML = regions().map(function(r){ return '<option value="'+esc(r)+'"></option>'; }).join("");
  }

  /* ---------- events ---------- */
  $("#tabs").addEventListener("click", function(e){
    var b=e.target.closest("button[data-view]"); if(!b) return;
    ui.view=b.dataset.view; render();
    window.scrollTo({top:0, behavior:"smooth"});
  });

  $("#view").addEventListener("click", function(e){
    var t=e.target.closest("[data-act]");
    var fk=e.target.closest("#funnelkey button[data-stage]");
    if (fk){ ui.stage = (ui.stage===fk.dataset.stage)?"":fk.dataset.stage; render(); return; }
    var mb=e.target.closest("button[data-map]");
    if (mb){ ui.map=mb.dataset.map; ui.sel=null; render(); return; }
    var pin=e.target.closest("[data-pin]");
    if (pin){ ui.sel = (ui.sel===pin.dataset.pin) ? null : pin.dataset.pin; render(); return; }
    if (!t) return;
    var act=t.dataset.act;

    if (act==="terr"){
      var g=e.target.closest("[data-terr]"); if(!g) return;
      ui.terr[g.dataset.terr] = !ui.terr[g.dataset.terr]; render(); return;
    }
    if (act==="unlog"){
      var li=e.target.closest("[data-sid]"); if(!li) return;
      var sid=Number(li.dataset.sid);
      state.signals = state.signals.filter(function(s){ return s.id!==sid; });
      render(); save(); return;
    }

    var host=e.target.closest("[data-id]"); if(!host) return;
    var id=host.dataset.id, x=find(id); if(!x) return;

    if (act==="toggle"){
      ui.open[id]=!ui.open[id]; render();
      if (ui.open[id]){
        var el=document.querySelector('.row[data-id="'+CSS.escape(id)+'"] .detail input');
        if (el) el.focus();
      }
    } else if (act==="delete"){
      state.venues=state.venues.filter(function(y){ return y.id!==id; });
      state.signals=state.signals.filter(function(s){ return s.venue!==id; });
      delete ui.open[id]; render(); save();
    } else if (act==="pin"){
      x.pin=!x.pin; render(); save();
    } else if (act==="redraft"){
      x.msg=draft(x); render(); save();
    } else if (act==="copy"){
      var ta=host.querySelector(".pmsg"); if(!ta) return;
      ta.select();
      try{ document.execCommand("copy"); t.textContent="Copied"; setTimeout(function(){ t.textContent="Copy draft"; },1400); }catch(err){}
      window.getSelection().removeAllRanges();
    }
  });

  $("#view").addEventListener("keydown", function(e){
    if (e.key!=="Enter" && e.key!==" ") return;
    var pin=e.target.closest("[data-pin]"); if(!pin) return;
    e.preventDefault();
    ui.sel = (ui.sel===pin.dataset.pin) ? null : pin.dataset.pin;
    render();
    var again=document.querySelector('[data-pin="'+CSS.escape(ui.sel||"")+'"]');
    if (again) again.focus();
  });

  function applyField(e){
    var f=e.target.closest("[data-f]"); if(!f) return;
    var host=e.target.closest("[data-id]"); if(!host) return;
    var x=find(host.dataset.id); if(!x) return;
    var key=f.dataset.f;
    if (key==="value") x.value=Number(f.value)||0;
    else if (key==="lat"||key==="lon"){ x[key] = f.value==="" ? null : Number(f.value); }
    else if (key==="tier"){ x.tier=f.value; }
    else x[key]=f.value;
    save();
    if (key==="msg") return;
    if (key==="stage"||key==="value"||key==="segment"||key==="tier"||key==="region"){ render(); return; }
    if (key==="name"){
      var h=host.querySelector(".vname");
      if (h && h.childNodes[0]) h.childNodes[0].nodeValue = x.name+" ";
    }
  }
  $("#view").addEventListener("change", applyField);
  $("#view").addEventListener("input", function(e){
    var f=e.target.closest("[data-f]");
    if (!f || f.tagName==="SELECT") return;
    applyField(e);
  });

  $("#view").addEventListener("submit", function(e){
    if (e.target.id!=="feedform") return;
    e.preventDefault();
    var fd=new FormData(e.target);
    var text=String(fd.get("text")||"").trim();
    if (!text) return;
    state.signals.push({
      id:Date.now(), date:String(fd.get("date")||today()),
      venue:String(fd.get("venue")||""), kind:String(fd.get("kind")||"note"), text:text
    });
    render(); save();
  });

  $("#view").addEventListener("input", function(e){
    if (e.target.id==="q"){ ui.q=e.target.value; var v=VIEWS.filter(function(z){return z.k===ui.view;})[0];
      var pos=e.target.selectionStart; $("#view").innerHTML=v.f();
      var q=$("#q"); if(q){ q.focus(); try{ q.setSelectionRange(pos,pos); }catch(err){} }
    }
  });
  $("#view").addEventListener("change", function(e){
    if (e.target.id==="fseg"){ ui.seg=e.target.value; render(); }
    else if (e.target.id==="freg"){ ui.reg=e.target.value; render(); }
    else if (e.target.id==="fstage"){ ui.stage=e.target.value; render(); }
    else if (e.target.id==="sort"){ ui.sort=e.target.value; render(); }
  });

  $("#add").addEventListener("click", function(){
    var id="venue-"+Date.now();
    state.venues.unshift({
      id:id, name:"New venue", city:"", country:"", region: ui.reg || (regions()[0]||"UK & Ireland"),
      cls:"Theatre", segment: ui.seg==="client" ? "client" : "prospect", tier:"mid",
      value:11000, lat:null, lon:null, stage:"identified", owner:"", nextStep:"", due:"", lastTouch:"",
      notes:"", msg:"", pin:false
    });
    ui.open[id]=true; ui.view="venues"; ui.q=""; ui.stage="";
    render(); save();
    var el=document.querySelector('.row[data-id="'+CSS.escape(id)+'"]');
    if (el) el.scrollIntoView({block:"center", behavior:"smooth"});
  });

  boot();
})();
