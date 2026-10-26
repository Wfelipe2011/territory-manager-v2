/* Protected superadmin dashboard. No sockets, framework migration or new mobile calls. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const usage = document.body.dataset.dashboard === 'usage';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const number = n => n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const date = d => d ? new Date(d).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo' }) : 'Sem registro';
  const text = (id, value) => { $(id).textContent = value; };
  const empty = (cols, message='Sem dados para este período') => `<tr><td colspan="${cols}" class="muted">${escape(message)}</td></tr>`;
  let data, paused = false, page = 0, controller, serial = 0, pending = false;
  const pageSize = 15;

  function params() {
    const query = new URLSearchParams({ groupBy:$('group').value });
    if ($('tenant').value) query.set('tenantId',$('tenant').value);
    if ($('period').value === 'custom') {
      const from = new Date($('from').value), to = new Date($('to').value);
      if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to) throw new Error('Informe datas válidas, com início anterior ao fim.');
      query.set('from',from.toISOString()); query.set('to',to.toISOString());
    } else query.set('period',$('period').value);
    return query;
  }

  async function refresh(automatic=false) {
    if (automatic && (pending || paused || document.hidden)) return;
    const request = ++serial;
    controller?.abort(); controller = new AbortController();
    pending = true; $('refresh').disabled = true;
    document.querySelector('main').setAttribute('aria-busy','true');
    try {
      const url = usage ? '/v1/dashboard/usage?'+params() : '/v1/health-check';
      const response = await fetch(url,{ signal:controller.signal,credentials:'same-origin',headers:{Accept:'application/json'} });
      if (!response.ok) {
        if (response.status===401 || response.status===403) throw new Error('Sessão expirada ou sem permissão. Entre novamente como superadmin.');
        throw new Error(response.status===400 ? 'Filtros inválidos. Use um intervalo de até 366 dias.' : 'Não foi possível atualizar os dados.');
      }
      const result = await response.json();
      if (request!==serial) return;
      data = result;
      $('status').classList.remove('error');
      if (usage) renderUsage(); else renderHealth();
    } catch (error) {
      if (request!==serial || error.name==='AbortError') return;
      $('status').classList.add('error');
      text('status',`${error.message} ${data ? 'Os valores anteriores podem estar desatualizados.' : 'Nenhum dado carregado.'}`);
      if (!usage) { text('api-state','Indisponível'); text('api-observed','Falha na consulta atual'); }
    } finally {
      if (request===serial) { pending=false; $('refresh').disabled=false; document.querySelector('main').setAttribute('aria-busy','false'); }
    }
  }

  function renderUsage() {
    const summary=data.summary;
    const selected=$('tenant').value;
    $('tenant').innerHTML='<option value="">Todas as congregações</option>'+data.options.map(t=>`<option value="${t.id}">${escape(t.name)} — ${escape(t.city)} / ${escape(t.state)}</option>`).join('');
    $('tenant').value=selected;
    text('scope',data.scope ? data.options.find(t=>t.id===data.scope).name : 'Todas as congregações');
    text('active',number(summary.activeCongregations)); text('active-detail',`de ${summary.congregations} · presença de campo ou alteração de rodada no período`);
    text('online',number(summary.online)); text('peak',number(summary.peak)); text('peak-at',summary.peakAt ? date(summary.peakAt) : 'Sem amostras no período');
    text('average',number(summary.average));
    const stale=!data.lastCollectedAt || Date.now()-Date.parse(data.lastCollectedAt)>90000;
    $('status').classList.toggle('error',stale);
    text('status',`${stale ? 'Atenção: coleta ausente ou atrasada. ' : ''}Última coleta: ${date(data.lastCollectedAt)} · atualizado ${date(data.generatedAt)}`);
    text('chart-detail',`${date(data.from)} → ${date(data.to)} · intervalos de ${data.groupSeconds/60} min${data.resolutionSeconds===3600 ? ' · agregados horários, limites arredondados' : ''}`);
    $('cities').innerHTML=data.cities.map(c=>`<tr><td>${escape(c.city)} / ${escape(c.state)}</td><td>${number(c.congregations)}</td><td>${number(c.active)}</td><td>${number(c.online)}</td></tr>`).join('') || empty(4);
    const labels={registeredUsers:'Usuários cadastrados (não ativos)',territories:'Territórios cadastrados',houses:'Casas aprovadas',openRounds:'Rodadas abertas agora',closedRounds:'Rodadas concluídas no período',completedHouses:'Casas com conclusão no período',pendingRequests:'Solicitações pendentes agora'};
    $('operation').innerHTML=Object.entries(labels).map(([key,label])=>`<div><span>${label}</span><strong>${number(summary[key])}</strong></div>`).join('');
    renderTenants(); renderChart();
  }

  function renderTenants() {
    if (!data) return;
    const search=$('search').value.toLocaleLowerCase('pt-BR');
    const rows=data.tenants.filter(t=>`${t.name} ${t.city} ${t.state}`.toLocaleLowerCase('pt-BR').includes(search));
    const sort=$('sort').value;
    rows.sort((a,b)=> sort==='name' ? a.name.localeCompare(b.name,'pt-BR') : (sort==='peak' ? (b.peak??-1)-(a.peak??-1) : sort==='activity' ? b.operationalActivity-a.operationalActivity : b.online-a.online) || a.name.localeCompare(b.name,'pt-BR'));
    const pages=Math.max(1,Math.ceil(rows.length/pageSize)); page=Math.min(page,pages-1);
    $('tenants').innerHTML=rows.slice(page*pageSize,(page+1)*pageSize).map(t=>`<tr>
      <td><strong>${escape(t.name)}</strong><small>${escape(t.city)} / ${escape(t.state)} · ID ${t.id}</small><small>${t.fieldActivity ? 'Presença de campo no período' : 'Sem presença coletada no período'}${t.operationalActivity>0 ? ' · alteração de rodada' : ''}</small></td>
      <td class="numeric">${number(t.online)}</td><td class="numeric">${number(t.peak)} / ${number(t.average)}<small>${t.peakAt ? escape(date(t.peakAt)) : 'Sem amostras'}</small></td>
      <td>${escape(date(t.lastActivity))}</td><td>${number(t.territories)} territórios<small>${number(t.houses)} casas · ${number(t.registeredUsers)} usuários</small></td>
      <td><button data-inspect="${t.id}" class="action">Ver indicadores</button><form action="/v1/admin/tenants/switch" method="POST"><input type="hidden" name="tenantId" value="${t.id}"><button type="submit" class="action" aria-label="Acessar ${escape(t.name)}">Acessar</button></form></td></tr>`).join('') || empty(6,'Nenhuma congregação encontrada');
    text('page',`${page+1} / ${pages} · ${rows.length} congregações`);
    $('previous').disabled=page===0; $('next').disabled=page===pages-1;
  }

  function renderChart() {
    const rows=[...data.series].sort((a,b)=>Date.parse(a.slotAt)-Date.parse(b.slotAt));
    $('series').innerHTML=rows.map(r=>`<tr><td>${escape(r.slot)}</td><td>${number(r.average)}</td><td>${number(r.active)}</td><td>${escape(date(r.peakAt))}</td><td>${number(r.samples)}</td></tr>`).join('') || empty(5);
    if (!rows.length) { $('chart').innerHTML='<text x="50" y="110">Sem amostras neste período. Histórico não é retroativo.</text>'; return; }
    const max=Math.max(1,...rows.map(r=>r.active));
    const start=Date.parse(data.from),end=Date.parse(data.to);
    const x=r=>60+(Date.parse(r.slotAt)-start)/Math.max(1,end-start)*900;
    const y=n=>195-n/max*160;
    const segments=[[]];
    rows.forEach((r,i)=>{ if(i && Date.parse(r.slotAt)-Date.parse(rows[i-1].slotAt)>data.groupSeconds*1000) segments.push([]); segments.at(-1).push(r); });
    $('chart').innerHTML=`<defs><clipPath id="plot"><rect x="60" y="20" width="900" height="180"/></clipPath></defs>`+
      [0,max/2,max].map(n=>`<line x1="60" y1="${y(n)}" x2="960" y2="${y(n)}" stroke="#35443d"/><text x="8" y="${y(n)+4}">${number(n)}</text>`).join('')+
      '<g clip-path="url(#plot)">'+segments.map(part=>['active','average'].map(key=>`<polyline fill="none" stroke="${key==='active'?'#70e1a4':'#a4c7ff'}" stroke-width="2" ${key==='average'?'stroke-dasharray="6 5"':''} points="${part.map(r=>`${x(r)},${y(r[key])}`).join(' ')}"/>`).join('')).join('')+
      rows.map(r=>`<circle cx="${x(r)}" cy="${y(r.active)}" r="2" fill="#70e1a4"><title>${escape(r.slot)} · pico ${r.active} · média ${r.average}</title></circle>`).join('')+'</g>'+
      `<text x="60" y="230">${escape(date(data.from))}</text><text x="960" y="230" text-anchor="end">${escape(date(data.to))}</text>`;
  }

  function renderHealth() {
    text('status',`Medição obtida em ${date(new Date().toISOString())}. Atualização a cada 30 segundos.`);
    text('api-state','Respondendo'); text('api-observed','API respondeu e consultou o banco');
    const info=data.system_info,db=data.database_info;
    text('uptime',`Uptime do sistema: ${Math.floor(info.uptime_seconds/86400)}d ${Math.floor(info.uptime_seconds%86400/3600)}h`);
    text('db-active',number(db.active)); text('db-detail',`${number(db.idle)} ociosas · limite ${number(db.max_connections)}`);
    text('cpu',number(info.cpu_usage_percent)+'%');text('memory',number(info.memory_usage_percent)+'%');
    text('memory-detail',`${number(info.used_memory_mb)} / ${number(info.total_memory_mb)} MB visíveis ao processo`);
    $('technical-context').innerHTML=Object.entries({'Load 1 / 5 / 15 min':Object.values(info.load_average).map(number).join(' / '),'Links ainda válidos':number(data.signatures),'Dispositivos online':number(data.activeSessions)}).map(([label,value])=>`<div><span>${label}</span><strong>${escape(value)}</strong></div>`).join('');
    $('changes').innerHTML=data.last_changes.map(r=>`<tr><td>${escape(r.congregation)}</td><td>${escape(r.city)}</td><td>${number(r.round)}</td><td>${escape(date(r.last_change_utc_minus3))}</td></tr>`).join('') || empty(4,'Nenhuma alteração registrada');
  }

  $('refresh').addEventListener('click',()=>refresh());
  $('pause').addEventListener('click',()=>{paused=!paused;$('pause').setAttribute('aria-pressed',String(paused));text('pause',paused?'Retomar atualização':'Pausar atualização');if(!paused)refresh();});
  if (usage) {
    for (const id of ['period','tenant','group']) $(id).addEventListener('change',()=>{page=0;$('custom-dates').hidden=$('period').value!=='custom';if($('period').value!=='custom'||($('from').value&&$('to').value))refresh();});
    $('search').addEventListener('input',()=>{page=0;renderTenants();});$('sort').addEventListener('change',()=>{page=0;renderTenants();});
    $('previous').addEventListener('click',()=>{page=Math.max(0,page-1);renderTenants();});$('next').addEventListener('click',()=>{page++;renderTenants();});
    $('tenants').addEventListener('click',event=>{const button=event.target.closest('[data-inspect]');if(button){$('tenant').value=button.dataset.inspect;page=0;refresh();}});
  }
  refresh();setInterval(()=>refresh(true),30000);
})();
