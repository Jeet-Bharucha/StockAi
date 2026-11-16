// Draw only provider trades received while this symbol was selected.
function createTradeLine(host) {
  const line = host.querySelector('path');
  const dot = host.querySelector('circle');
  const caption = host.querySelector('[data-trade-status]');
  const scale = host.querySelector('[data-trade-scale]');
  const times = host.querySelector('[data-trade-times]');
  const money = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4});
  const clock = new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'});
  const windowMs = 300000;
  let symbol = '', points = [], latest = null, gap = false, changed = true;
  let previousStatus = '';
  function reset(nextSymbol) {
    symbol = nextSymbol; points = []; latest = null; gap = false; changed = true;
    draw();
  }
  function record({price,time}, now = Date.now()) {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(time) ||
        time <= 0 || time > now + 1000 || now - time > windowMs || (latest && time < latest.time)) return false;
    const point = {price,time, gap};
    const last = points[points.length - 1];
    if (last && Math.floor(last.time / 1000) === Math.floor(time / 1000)) {
      point.gap = gap || last.gap;
      points[points.length - 1] = point;
    } else points.push(point);
    gap = false;
    latest = point;
    while (points[0].time < time - windowMs) points.shift();
    changed = true;
    return true;
  }
  function draw(now = Date.now()) {
    const connected = StockAPI._wsStatus === 'connected';
    const status = !latest
      ? (connected ? 'Waiting for the first '+symbol+' trade' : 'Waiting for the '+symbol+' trade feed')
      : (connected && now - latest.time < 60000 ? 'Live trade' : connected ? 'Last trade' : 'Stream offline · last trade') +
          ' · '+symbol+' '+money.format(latest.price)+' · '+(now-latest.time >= 86400000 ? new Date(latest.time).toLocaleString() : clock.format(latest.time));
    if (status !== previousStatus) { caption.textContent = status; previousStatus = status; }
    if (!changed) return;
    changed = false;
    if (!points.length) {
      line.setAttribute('d',''); dot.setAttribute('visibility','hidden');
      scale.textContent = ''; times.textContent = ''; return;
    }
    const first = points[0], end = latest.time;
    const prices = points.map(p => p.price);
    const low = Math.min(...prices), high = Math.max(...prices);
    const start = Math.min(first.time, end - 1000);
    let path = '', x, y;
    for (let i=0; i<points.length; i++) {
      const p = points[i];
      x = 4 + 592 * (p.time-start)/(end-start);
      y = high === low ? 50 : 92 - 84*(p.price-low)/(high-low);
      const disconnected = i===0 || p.gap || p.time-points[i-1].time > 30000;
      path += (disconnected ? 'M' : 'L') + x.toFixed(2)+' '+y.toFixed(2)+' ';
    }
    line.setAttribute('d',path);
    dot.setAttribute('cx',x); dot.setAttribute('cy',y); dot.setAttribute('visibility','visible');
    host.dataset.direction = latest.price===first.price ? 'flat' : latest.price>first.price ? 'up' : 'down';
    scale.textContent = low===high ? money.format(low) : money.format(low)+' – '+money.format(high);
    times.textContent = clock.format(first.time)+' – '+clock.format(end);
  }
  return {reset,record,draw,get latest(){return latest;},disconnect(){gap=true;draw();}};
}
