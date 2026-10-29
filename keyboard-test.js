import {KeyboardMeter} from './keyboard-core.mjs';
const $=id=>document.getElementById(id), meter=new KeyboardMeter(), labels=new Map(), keys=new Map();
let running=false;
const item=(code,label=code,w=1)=>({code,label,w});
const chars=(s,prefix='Key')=>[...s].map(c=>item(prefix+c,c));
const main=[
 [item('Escape','Esc'),...Array.from({length:12},(_,i)=>item('F'+(i+1),'F'+(i+1)))],
 [item('Backquote','` ~'),...chars('1234567890','Digit'),item('Minus','-'),item('Equal','='),item('Backspace','Backspace',2)],
 [item('Tab','Tab',1.5),...chars('QWERTYUIOP'),item('BracketLeft','['),item('BracketRight',']'),item('Backslash','\\',1.5)],
 [item('CapsLock','Caps',1.8),...chars('ASDFGHJKL'),item('Semicolon',';'),item('Quote',"'"),item('Enter','Enter',2.2)],
 [item('ShiftLeft','Shift',2.3),...chars('ZXCVBNM'),item('Comma',','),item('Period','.'),item('Slash','/'),item('ShiftRight','Shift',2.7)],
 [item('ControlLeft','Ctrl',1.4),item('MetaLeft','Win'),item('AltLeft','Alt'),item('Space','Space',5.7),item('AltRight','Alt/한영',1.5),item('MetaRight','Win'),item('ContextMenu','Menu'),item('ControlRight','Ctrl/한자',1.5)]
];
const navigation=[['PrintScreen','ScrollLock','Pause'],['Insert','Home','PageUp'],['Delete','End','PageDown'],[null,null,null],[null,'ArrowUp',null],['ArrowLeft','ArrowDown','ArrowRight']].map(r=>r.map(c=>item(c,({PrintScreen:'PrtSc',ScrollLock:'Scroll',PageUp:'PgUp',PageDown:'PgDn',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'})[c]||c)));
const numpad=[['NumLock','NumpadDivide','NumpadMultiply','NumpadSubtract'],['Numpad7','Numpad8','Numpad9','NumpadAdd'],['Numpad4','Numpad5','Numpad6',null],['Numpad1','Numpad2','Numpad3','NumpadEnter'],['Numpad0','NumpadDecimal',null,null],['Lang1','Lang2',null,null]].map(r=>r.map(c=>item(c,({NumLock:'Num',NumpadDivide:'/',NumpadMultiply:'*',NumpadSubtract:'−',NumpadAdd:'+',NumpadEnter:'Enter',NumpadDecimal:'.',Lang1:'한/영',Lang2:'한자'})[c]||c?.replace('Numpad',''))));
for(const rows of [main,navigation,numpad]){const section=document.createElement('div');section.className='key-section';for(const row of rows){const el=document.createElement('div');el.className='key-row';for(const k of row){const key=document.createElement('span');key.className='key'+(!k.code?' empty':'');key.textContent=k.label||'';key.style.setProperty('--w',k.w);if(k.code){key.dataset.code=k.code;key.setAttribute('aria-label',k.label+' 미확인');keys.set(k.code,key);labels.set(k.code,k.label);}el.append(key);}section.append(el);}$('keyboard').append(section);}
function render(){
 $('tested').textContent=meter.tested.size;$('total').textContent=meter.total;$('chatter').textContent=meter.chatter;$('current').textContent=meter.pressed.size;$('maximum').textContent=meter.max;
 for(const [code,el] of keys){el.classList.toggle('tested',meter.tested.has(code));el.classList.toggle('pressed',meter.pressed.has(code));el.classList.toggle('suspect',meter.suspects.has(code));el.setAttribute('aria-label',labels.get(code)+(meter.suspects.has(code)?' 중복 입력 의심':meter.pressed.has(code)?' 누르는 중':meter.tested.has(code)?' 입력 확인':' 미확인'));}
 $('records').replaceChildren();for(const code of [...meter.tested].reverse()){const tr=document.createElement('tr');for(const text of [labels.get(code)||code,meter.counts.get(code),meter.suspects.get(code)||0]){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('records').append(tr);}
 if(!meter.tested.size){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent='아직 입력한 키가 없습니다.';tr.append(td);$('records').append(tr);}
}
function pause(message='측정이 멈췄습니다. 테스트 시작을 눌러 계속하세요.'){running=false;meter.pause();$('start').textContent='테스트 시작';$('status').textContent=message;render();}
$('start').addEventListener('click',()=>{if(running){pause();return;}running=true;$('start').textContent='테스트 종료';$('start').blur();$('status').textContent='측정 중 · Esc를 누르면 종료됩니다.';});
$('reset').addEventListener('click',()=>{meter.reset();$('latest').textContent='입력 대기';render();});
window.addEventListener('keydown',e=>{if(!running)return;if(e.code==='Escape'){meter.down(e.code,performance.now(),e.repeat);$('latest').textContent='Esc · 테스트 종료';pause();return;}if(!e.metaKey&&!e.altKey)e.preventDefault();if(meter.down(e.code,performance.now(),e.repeat)){$('latest').textContent=(labels.get(e.code)||e.code)+' · 입력 '+meter.counts.get(e.code)+'회';render();}});
window.addEventListener('keyup',e=>{if(!running)return;meter.up(e.code,performance.now());render();});
window.addEventListener('blur',()=>{if(running)pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause();});
render();
