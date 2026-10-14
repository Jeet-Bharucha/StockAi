/* StockAI Signal Evidence v1 — historical directional checks, NOT price forecasts.
   Each fixed-rule evaluation uses only bars at or before its signal time.
   A signal at close[t] is evaluated from next session's OPEN to close[t+5].
   Windows never overlap. Estimated costs: 10 basis points round-trip.
   No execution, slippage, short borrowing, spread, taxes or survivorship model.
*/
const SignalEvidence = {
  HORIZON: 5,
  HISTORY: 210,
  STRIDE: 5,
  MAX_SAMPLES: 48,
  COST_PCT: 0.10,

  _validate(bars) {
    if (!Array.isArray(bars)) throw new Error('Historical price data is missing');
    let prev = -Infinity;
    return bars.map((bar, i) => {
      const time = typeof bar.time === 'number' ? bar.time :
        typeof bar.time === 'string' ? Date.parse(bar.time) / 1000 : NaN;
      const open = Number(bar.open), close = Number(bar.close);
      const high = Number(bar.high), low = Number(bar.low);
      const volume = Number(bar.volume);
      if (!Number.isFinite(time) || time <= prev ||
          ![open,close,high,low].every(v=>Number.isFinite(v)&&v>0) ||
          high < low || high < Math.max(open,close) || low > Math.min(open,close) ||
          !Number.isFinite(volume) || volume < 0) {
        throw new Error('Invalid or unsorted historical candle at index ' + i);
      }
      prev = time;
      return { time, open, high, low, close, volume };
    });
  },

  _wilson(wins, count) {
    if (!count) return null;
    const z=1.96, p=wins/count, z2=z*z;
    const center=(p+z2/(2*count))/(1+z2/count);
    const margin=z*Math.sqrt(p*(1-p)/count+z2/(4*count*count))/(1+z2/count);
    return [Math.round(Math.max(0,center-margin)*1000)/10,
            Math.round(Math.min(1,center+margin)*1000)/10];
  },

  _summarize(rows, errors) {
    const directional = rows.filter(r=>r.direction!=='NEUTRAL');
    const sum = arr=>arr.reduce((a,b)=>a+b,0);
    const wins=directional.filter(r=>r.correct).length;
    const n=directional.length;
    const up=directional.filter(r=>r.direction==='UP');
    const down=directional.filter(r=>r.direction==='DOWN');
    const round=v=>Number.isFinite(v)?Math.round(v*100)/100:null;
    return {
      horizonSessions:this.HORIZON,
      roundTripCostPct:this.COST_PCT,
      evaluations:rows.length,
      directionalSignals:n,
      neutralSignals:rows.length-n,
      wins,
      hitRatePct:n?round(wins*100/n):null,
      hitRate95Pct:this._wilson(wins,n),
      avgDirectionalReturnPct:n?round(sum(directional.map(r=>r.strategyReturnPct))/n):null,
      avgBaselineLongReturnPct:n?round(sum(directional.map(r=>r.baselineLongReturnPct))/n):null,
      bullSignals:up.length,
      bearSignals:down.length,
      rows:rows.slice(-8).reverse(),
      errors,
      evidenceLevel:n>=30?'exploratory':n>=10?'limited':'insufficient',
      note:'Exploratory fixed-rule replay, not an independently validated AI forecast. Signals are measured at the historical close; hypothetical entry is next session open, exit at the fifth next close. Non-overlapping windows and 0.10% estimated round-trip cost. No spreads, slippage, borrow, tax or execution constraints. Does not predict future returns.'
    };
  },

  _runAt(bars, i) {
    // Historical feature window strictly ends at signal close; future candles
    // cannot affect the signal or indicator calculation.
    const signal=AIPredictor.predict(bars.slice(0,i+1));
    if (!['UP','DOWN','NEUTRAL'].includes(signal.direction))
      throw new Error('Invalid prediction direction');
    const entry=bars[i+1].open;
    const exit=bars[i+this.HORIZON].close;
    const futurePct=(exit/entry-1)*100;
    const isUp=signal.direction==='UP';
    const isDown=signal.direction==='DOWN';
    const round=v=>Math.round(v*100)/100;
    return {
      signalTime:bars[i].time,
      direction:signal.direction,
      entryTime:bars[i+1].time,
      exitTime:bars[i+this.HORIZON].time,
      entryPrice:round(entry),
      exitPrice:round(exit),
      marketReturnPct:round(futurePct),
      correct:isUp?futurePct>0:isDown?futurePct<0:null,
      strategyReturnPct:isUp?round(futurePct-this.COST_PCT):
        isDown?round(-futurePct-this.COST_PCT):null,
      baselineLongReturnPct:round(futurePct-this.COST_PCT)
    };
  },

  _indices(length) {
    // Require 210 prior sessions; leave 5 future sessions after each signal.
    const latest=length-1-this.HORIZON;
    if (latest < this.HISTORY-1) return [];
    const result=[];
    for(let i=latest;i>=this.HISTORY-1&&result.length<this.MAX_SAMPLES;i-=this.STRIDE)
      result.push(i);
    return result.reverse();
  },

  evaluate(sourceBars) {
    const bars=this._validate(sourceBars);
    const rows=[], errors=[];
    for(const i of this._indices(bars.length)) {
      try { rows.push(this._runAt(bars,i)); }
      catch(err){errors.push('Historical sample '+i+': '+err.message);}
    }
    return this._summarize(rows,errors);
  },

  async evaluateAsync(sourceBars, onProgress) {
    const bars=this._validate(sourceBars);
    const indices=this._indices(bars.length), rows=[], errors=[];
    for(let j=0;j<indices.length;j++) {
      try { rows.push(this._runAt(bars,indices[j])); }
      catch(err){errors.push('Historical sample '+indices[j]+': '+err.message);}
      if((j+1)%4===0) {
        if(typeof onProgress==='function') onProgress(j+1,indices.length);
        // Yield for rendering and user interaction, not busy-loop on long history.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    return this._summarize(rows,errors);
  }
};
