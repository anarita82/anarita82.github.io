export class KeyboardMeter {
  constructor(){this.reset();}
  reset(){this.pressed=new Set();this.tested=new Set();this.lastUp=new Map();this.counts=new Map();this.suspects=new Map();this.total=0;this.max=0;}
  down(code,time,repeat=false){
    if(!code||code==='Unidentified'||repeat||this.pressed.has(code))return false;
    const last=this.lastUp.get(code);
    if(last!==undefined&&time-last>=0&&time-last<=30)this.suspects.set(code,(this.suspects.get(code)||0)+1);
    this.pressed.add(code);this.tested.add(code);this.counts.set(code,(this.counts.get(code)||0)+1);this.total++;this.max=Math.max(this.max,this.pressed.size);return true;
  }
  up(code,time){if(this.pressed.delete(code))this.lastUp.set(code,time);}
  pause(){this.pressed.clear();this.lastUp.clear();}
  get chatter(){return [...this.suspects.values()].reduce((a,b)=>a+b,0);}
}
