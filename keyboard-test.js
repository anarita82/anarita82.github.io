import {KeyboardMeter} from './keyboard-core.mjs?v=auto-20261029';
const $=id=>document.getElementById(id), meter=new KeyboardMeter(), labels=new Map(), keys=new Map();
let running=document.hasFocus();
const item=(code,label=code,w=1)=>({code,label,w});
const chars=(s,prefix='Key')=>[...s].map(c=>item(prefix+c,c));
const main=[
 [item('Escape','Esc'),item(null,'',1),...Array.from({length:4},(_,i)=>item('F'+(i+1),'F'+(i+1))),item(null,'',0.5),...Array.from({length:4},(_,i)=>item('F'+(i+5),'F'+(i+5))),item(null,'',0.5),...Array.from({length:4},(_,i)=>item('F'+(i+9),'F'+(i+9)))],
 [item('Backquote','` ~'),...chars('1234567890','Digit'),item('Minus','-'),item('Equal','='),item('Backspace','Backspace',2)],
 [item('Tab','Tab',1.5),...chars('QWERTYUIOP'),item('BracketLeft','['),item('BracketRight',']'),item('Backslash','\\',1.5)],
 [item('CapsLock','Caps Lock',1.75),...chars('ASDFGHJKL'),item('Semicolon','; :'),item('Quote',"' \""),item('Enter','Enter',2.25)],
 [item('ShiftLeft','Shift',2.25),...chars('ZXCVBNM'),item('Comma',', <'),item('Period','. >'),item('Slash','/ ?'),item('ShiftRight','Shift',2.75)],
 [item('ControlLeft','Ctrl',1.25),item('MetaLeft','Win',1.25),item('AltLeft','Alt',1.25),item('Space','Space',6.25),item('AltRight','Alt',1.25),item('MetaRight','Win',1.25),item('ContextMenu','Menu',1.25),item('ControlRight','Ctrl',1.25)]
];
const navigation=[['PrintScreen','ScrollLock','Pause'],['Insert','Home','PageUp'],['Delete','End','PageDown'],[null,null,null],[null,'ArrowUp',null],['ArrowLeft','ArrowDown','ArrowRight']].map(r=>r.map(c=>item(c,({PrintScreen:'PrtSc',ScrollLock:'Scroll',PageUp:'PgUp',PageDown:'PgDn',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'})[c]||c)));
function makeKey(k){const key=document.createElement('span');key.className='key'+(!k.code?' empty':'');const name=document.createElement('span');name.className='key-label';name.textContent=k.label||'';key.append(name);if(k.code){const count=document.createElement('small');count.className='key-count';count.textContent='0회';key.append(count);}key.style.setProperty('--w',k.w);if(k.code){key.dataset.code=k.code;key.setAttribute('aria-label',k.label+' 미확인');keys.set(k.code,key);labels.set(k.code,k.label);}return key;}
for(const rows of [main,navigation]){const section=document.createElement('div');section.className='key-section';for(const row of rows){const el=document.createElement('div');el.className='key-row';for(const k of row)el.append(makeKey(k));section.append(el);}$('keyboard').append(section);}
const pad=document.createElement('div');pad.className='number-pad';
const padRows=[['NumLock','NumpadDivide','NumpadMultiply','NumpadSubtract'],['Numpad7','Numpad8','Numpad9','NumpadAdd'],['Numpad4','Numpad5','Numpad6'],['Numpad1','Numpad2','Numpad3','NumpadEnter'],['Numpad0',null,'NumpadDecimal']];
const padLabels={NumLock:'Num Lock',NumpadDivide:'/',NumpadMultiply:'*',NumpadSubtract:'−',NumpadAdd:'+',NumpadEnter:'Enter',NumpadDecimal:'. Del',Numpad0:'0 Ins'};
padRows.forEach((row,r)=>row.forEach((code,c)=>{if(!code)return;const key=makeKey(item(code,padLabels[code]||code.replace('Numpad','')));key.style.gridColumn=(c+1)+(code==='Numpad0'?' / span 2':'');key.style.gridRow=(r+1)+(['NumpadAdd','NumpadEnter'].includes(code)?' / span 2':'');pad.append(key);}));$('keyboard').append(pad);
function render(){
 const known=[...keys.keys()].filter(code=>meter.tested.has(code));$('tested').textContent=known.length+' / 104';$('progress').value=known.length;$('progress-text').textContent=known.length+' / 104개 입력 확인';$('remaining-count').textContent=104-known.length;$('remaining').textContent=[...keys.keys()].filter(code=>!meter.tested.has(code)).map(code=>labels.get(code)+' ('+code+')').join(' · ')||'배열에 표시된 모든 키가 입력되었습니다.';$('total').textContent=meter.total;$('chatter').textContent=meter.chatter;$('current').textContent=meter.pressed.size;$('maximum').textContent=meter.max;
 for(const [code,el] of keys){el.querySelector('.key-count').textContent=(meter.counts.get(code)||0)+'회';el.classList.toggle('tested',meter.tested.has(code));el.classList.toggle('pressed',meter.pressed.has(code));el.classList.toggle('suspect',meter.suspects.has(code));el.setAttribute('aria-label',labels.get(code)+(meter.suspects.has(code)?' 중복 입력 의심':meter.pressed.has(code)?' 누르는 중':meter.tested.has(code)?' 입력 확인':' 미확인'));}
 const alerts=[...meter.suspects].map(([code,count])=>(labels.get(code)||code)+' '+count+'회'+(meter.gaps.has(code)?' · 최근 재입력 '+meter.gaps.get(code).toFixed(1)+'ms':''));$('alerts').textContent=alerts.length?'중복 입력 의심: '+alerts.join(' · '):'중복 입력 의심 없음';$('alerts').classList.toggle('has-alert',alerts.length>0);$('records').replaceChildren();for(const code of [...meter.tested].reverse()){const tr=document.createElement('tr');for(const text of [labels.get(code)||code,meter.counts.get(code),meter.suspects.get(code)||0,meter.gaps.has(code)?meter.gaps.get(code).toFixed(1)+'ms':'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('records').append(tr);}
 if(!meter.tested.size){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='아직 입력한 키가 없습니다.';tr.append(td);$('records').append(tr);}
}
function pause(){running=false;meter.pause();$('status').textContent='다른 화면으로 이동하여 입력 대기 중 · 돌아오면 자동 측정';render();}
function resume(){if(document.hidden)return;meter.pause();running=true;$('status').textContent='바로 측정 중 · 실제 키보드를 눌러 주세요.';render();}
$('reset').addEventListener('click',()=>{meter.reset();$('latest').textContent='입력 대기';$('reset').blur();running=true;$('status').textContent='초기화 완료 · 바로 측정 중';render();});
window.addEventListener('keydown',e=>{if(!running||e.isComposing||e.keyCode===229||e.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;if(!e.metaKey&&!e.altKey)e.preventDefault();if(meter.down(e.code,performance.now(),e.repeat)){$('latest').textContent=(labels.get(e.code)||e.code)+' · 입력 '+meter.counts.get(e.code)+'회';render();}});
window.addEventListener('keyup',e=>{if(!running)return;meter.up(e.code,performance.now());render();});
window.addEventListener('blur',pause);window.addEventListener('focus',resume);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else if(document.hasFocus())resume();});
if(running)resume();else pause();

