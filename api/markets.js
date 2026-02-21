module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = { polymarket:[], kalshi:[], manifold:[], metaculus:[], errors:{}, fetchedAt: new Date().toISOString() };

  async function go(url) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 9000);
    try {
      const r = await fetch(url, { signal: c.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch(e) { clearTimeout(t); throw e; }
  }

  await Promise.allSettled([
    go('https://gamma-api.polymarket.com/markets?limit=50&active=true&order=volume&ascending=false')
      .then(data => {
        const ms = Array.isArray(data) ? data : (data.markets || []);
        results.polymarket = ms.map(m => {
          let yes = 0;
          try { const p = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : (m.outcomePrices||[]); yes = parseFloat(p[0])||0; } catch(_){}
          return { id: m.id||m.conditionId, source:'Polymarket', name: m.question||'Unknown', yesPrice: yes, volume: parseFloat(m.volume||0), volume24h: parseFloat(m.volume24hr||0), change: ((yes - parseFloat(m.lastTradePrice||yes))*100).toFixed(1), category: m.category||'' };
        }).filter(m => m.volume>=50000 && m.yesPrice>0.02 && m.yesPrice<0.98).sort((a,b)=>b.volume24h-a.volume24h).slice(0,20);
      }).catch(e => { results.errors.polymarket = e.message; }),

    go('https://api.elections.kalshi.com/trade-api/v2/markets?limit=50&status=open')
      .then(data => {
        results.kalshi = (data.markets||[]).map(m => {
          const bid=m.yes_bid||0, ask=m.yes_ask||0, last=m.last_price||0;
          let yes;
          if(bid>0&&ask>0) yes=((bid+ask)/2)/100; else if(last>0) yes=last/100; else if(bid>0) yes=bid/100; else if(ask>0) yes=ask/100; else return null;
          return { id:m.ticker, source:'Kalshi', name:m.title||'Unknown', yesPrice:yes, volume:m.volume||0, volume24h:m.volume_24h||0, change:(bid>0&&(m.previous_yes_bid||0)>0)?(bid-(m.previous_yes_bid||0)).toFixed(1):'0.0', category:m.category||'' };
        }).filter(m=>m&&m.volume>=5000&&m.yesPrice>0.02&&m.yesPrice<0.98).sort((a,b)=>b.volume-a.volume).slice(0,20);
      }).catch(e => { results.errors.kalshi = e.message; }),

    go('https://api.manifold.markets/v0/markets?limit=50&sort=liquidity&filter=open')
      .then(data => {
        results.manifold = (Array.isArray(data)?data:[]).filter(m=>m.outcomeType==='BINARY'&&m.probability&&(m.volume||0)>=1000&&m.probability>0.03&&m.probability<0.97).sort((a,b)=>(b.volume||0)-(a.volume||0)).slice(0,15).map(m=>({id:m.id,source:'Manifold',name:m.question,yesPrice:m.probability,volume:m.volume||0,volume24h:0,change:'0.0',category:m.groupSlugs?.[0]||''}));
      }).catch(e => { results.errors.manifold = e.message; }),

    go('https://www.metaculus.com/api2/questions/?order_by=-number_of_forecasters&type=forecast&status=open&limit=30')
      .then(data => {
        results.metaculus = (data.results||[]).filter(q=>q.community_prediction?.full?.q2!=null&&(q.number_of_forecasters||0)>=50).sort((a,b)=>(b.number_of_forecasters||0)-(a.number_of_forecasters||0)).slice(0,12).map(q=>({id:String(q.id),source:'Metaculus',name:q.title,yesPrice:q.community_prediction.full.q2,volume:q.number_of_forecasters||0,volume24h:0,change:'0.0',category:q.categories?.[0]?.name||''}));
      }).catch(e => { results.errors.metaculus = e.message; }),
  ]);

  res.status(200).json(results);
};
