(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  function dateValue(text, today) {
    const base = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today || '');
    if (!base) return '';
    const value = text.trim().replace(/\s/g, '');
    if (['오늘','어제','그제','그저께','내일'].includes(value)) {
      const offset = {오늘:0,어제:-1,그제:-2,그저께:-2,내일:1}[value];
      return new Date(Date.UTC(+base[1], +base[2]-1, +base[3]+offset)).toISOString().slice(0,10);
    }
    const digits = {영:0,공:0,일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9};
    const number = word => /^\d+$/.test(word) ? +word : word.includes('십')
      ? (word.split('십')[0] ? digits[word.split('십')[0]] : 1)*10 + (word.split('십')[1] ? digits[word.split('십')[1]] : 0)
      : digits[word];
    const match = /^(?:(\d{4})년)?([\d영공일이삼사오육칠팔구십]+)월([\d영공일이삼사오육칠팔구십]+)일$/.exec(value);
    const iso = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(value);
    if (!match && !iso) return '';
    const year = +(iso ? iso[1] : match[1] || base[1]);
    const month = iso ? +iso[2] : number(match[2]);
    const day = iso ? +iso[3] : number(match[3]);
    if (year < 1900 || year > 9999 || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return '';
    const result = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10) === result ? result : '';
  }
  function composeNote(address, note) {
    const result = [address.trim() ? '주소: ' + address.trim() : '', note.trim()].filter(Boolean).join('\n\n');
    if (result.length > 1000) throw new Error('주소와 메모를 합쳐 1,000자 이하로 입력해 주세요.');
    return result;
  }
  window.smReceiptVoice = { dateValue, composeNote };
  const form = $('#receipt-form');
  if (!form) return;
  const node = (tag, text, attrs = {}) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    for (const [key,value] of Object.entries(attrs)) e.setAttribute(key,value);
    return e;
  };
  const addressLabel = node('label','주소');
  const address = node('textarea','',{id:'receipt-address',rows:'2',maxlength:'300',autocomplete:'street-address'});
  addressLabel.append(address);
  $('#customer').closest('label').after(addressLabel);
  const tip = node('p','사진 없이도 입력·저장할 수 있습니다. 주소는 비공개 메모에 구분 저장됩니다.',{class:'muted'});
  addressLabel.after(tip);
  const dialog = node('section','',{id:'voice-dialog','aria-labelledby':'voice-title',role:'region'});
  dialog.hidden = true;
  const heading = node('h2','',{id:'voice-title'});
  const disclosure = node('p','음성과 말한 정보는 브라우저 음성 인식 제공자에게 전송될 수 있습니다. 결과 확인 후 적용해 주세요.',{class:'muted'});
  const resultLabel = node('label','인식 결과 · 적용 전 수정 가능');
  const result = node('textarea','',{id:'voice-result',rows:'2',maxlength:'300'});
  resultLabel.append(result);
  const status = node('p','입력칸을 누르면 음성 인식이 시작됩니다.',{id:'voice-status',role:'status','aria-live':'polite',class:'muted'});
  const actions = node('div','',{class:'dialog-actions voice-actions'});
  const start = node('button','음성 인식 시작',{type:'button',class:'primary'});
  const stop = node('button','인식 중지',{type:'button',class:'secondary'});
  const apply = node('button','항목에 적용',{type:'button',class:'primary'});
  const cancel = node('button','취소',{type:'button',class:'secondary'});
  stop.disabled = true; apply.disabled = true;
  actions.append(apply,cancel,start,stop);
  dialog.append(heading,disclosure,resultLabel,status,actions);
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = Boolean(Recognition && window.isSecureContext);
  let target = null, recognition = null, generation = 0, timer = null;
  const current = () => !dialog.hidden && $('#receipt-dialog').open && !$('#workspace').hidden;
  function abort() {
    generation++;
    const old = recognition; recognition = null;
    clearTimeout(timer); timer = null;
    if (old) { try { old.abort(); } catch {} }
    start.disabled = false; stop.disabled = true;
  }
  function close() { abort(); dialog.hidden = true; result.value = ''; target = null; }
  const manualLabel = node('label','',{class:'check-label voice-manual'});
  const manual = node('input','',{type:'checkbox',id:'voice-manual'});
  manualLabel.append(manual, node('span','키보드로 직접 입력'));
  tip.after(manualLabel);
  tip.textContent += ' 입고일·입고처·주소·메모 입력칸을 누르면 음성 인식을 시작합니다. 음성과 말한 정보는 브라우저 음성 인식 제공자에게 전송될 수 있습니다. 서울마우스는 음성 파일을 저장하지 않습니다.';
  const fields = [];
  for (const [id,label] of [['received-date','입고일'],['customer','입고처'],['receipt-address','주소'],['receipt-note','메모']]) {
    const input = $('#'+id);
    fields.push(input);
    input.readOnly = supported;
    input.setAttribute('aria-describedby','voice-field-help');
    const open = () => {
      if (!supported || manual.checked || !$('#receipt-dialog').open || $('#workspace').hidden || (current() && target === input)) return;
      abort(); target = input; result.value = ''; apply.disabled = true;
      result.maxLength = id === 'receipt-note' ? 1000 : 300;
      result.value = id === 'receipt-note' ? input.value : '';
      heading.textContent = label + ' 음성 입력';
      input.closest('label').before(dialog);
      dialog.hidden = false;
      beginRecognition();
      dialog.scrollIntoView?.({block:'start',behavior:'auto'});
    };
    input.addEventListener('click',open);
    input.addEventListener('keydown',event=>{ if (!manual.checked && supported && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); } });
  }
  tip.setAttribute('id','voice-field-help');
  if (!supported) { manual.checked = true; manual.disabled = true; tip.textContent = '사진 없이도 입력·저장할 수 있습니다. 주소는 비공개 메모에 구분 저장됩니다. 이 브라우저는 음성 인식을 지원하지 않습니다. 직접 입력하거나 휴대폰 키보드 마이크를 이용해 주세요.'; }
  manual.addEventListener('change',()=>{ close(); for (const input of fields) input.readOnly = supported && !manual.checked; });
  form.addEventListener('reset',()=>{ for (const input of fields) input.readOnly = supported; if (!supported) manual.checked = true; });
  function beginRecognition() {
    if (!current() || !target || !supported) return;
    abort(); const version = generation;
    const previous = target.id === 'receipt-note' ? target.value.trim() : '';
    result.value = previous; apply.disabled = !previous;
    const session = new Recognition(); recognition = session;
    session.lang = 'ko-KR'; session.continuous = false; session.interimResults = false;
    start.disabled = true; stop.disabled = false;
    status.textContent = '듣는 중입니다. 해당 항목만 말씀해 주세요.';
    session.onresult = event => {
      if (version !== generation || !current()) return;
      const spoken = Array.from(event.results).filter(r=>r.isFinal).map(r=>r[0].transcript).join(' ');
      result.value = [previous,spoken].filter(Boolean).join('\n');
      apply.disabled = !result.value.trim();
      status.textContent = '내용을 확인·수정하고 항목에 적용해 주세요. 아직 저장되지 않았습니다.';
    };
    session.onerror = event => {
      if (version !== generation || !current()) return;
      const errors = {'not-allowed':'마이크 권한이 거부되었습니다. 직접 입력하거나 브라우저 권한을 확인해 주세요.','no-speech':'음성을 듣지 못했습니다. 다시 시작하거나 직접 입력해 주세요.',network:'음성 인식 서비스에 연결하지 못했습니다. 직접 입력해 주세요.','audio-capture':'마이크를 사용할 수 없습니다. 연결 상태를 확인해 주세요.'};
      status.textContent = errors[event.error] || '음성 인식이 중단되었습니다. 다시 시작하거나 직접 입력해 주세요.';
    };
    session.onend = () => {
      if (version !== generation) return;
      clearTimeout(timer); recognition = null; start.disabled = false; stop.disabled = true;
      if (!result.value && status.textContent.startsWith('듣는 중')) status.textContent = '인식 결과가 없습니다. 다시 시작하거나 직접 입력해 주세요.';
    };
    try { session.start(); timer = setTimeout(()=>{ if (version === generation) { abort(); status.textContent = '인식 시간이 종료되었습니다. 결과를 확인하거나 다시 시작해 주세요.'; } },30000); }
    catch { abort(); status.textContent = '음성 인식을 시작하지 못했습니다. 직접 입력해 주세요.'; }
  }
  start.addEventListener('click',beginRecognition);
  stop.addEventListener('click', () => { if (recognition) { try { recognition.stop(); } catch { abort(); } stop.disabled = true; } });
  result.addEventListener('input', () => { apply.disabled = !result.value.trim(); });
  apply.addEventListener('click', () => {
    if (!current() || !target || !result.value.trim()) return;
    let value = result.value.trim();
    if (target.id === 'received-date') {
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      value = dateValue(value,today);
      if (!value) { status.textContent = '날짜를 확인해 주세요. 예: 2026년 10월 24일 / 오늘'; return; }
    } else if (value.length > target.maxLength) { status.textContent = `이 항목은 ${target.maxLength}자 이하로 입력해 주세요.`; return; }
    target.value = value;
    target.dispatchEvent(new Event('input',{bubbles:true}));
    $('#receipt-confirmed').checked = false;
    close();
  });
  cancel.addEventListener('click',close);
  dialog.addEventListener('close',close);
  dialog.addEventListener('cancel',event=>{ event.preventDefault(); close(); });
  $('#receipt-dialog').addEventListener('close',close);
  form.addEventListener('reset',close);
  form.addEventListener('submit',close,true);
  document.addEventListener('visibilitychange',()=>{ if (document.hidden) close(); });
  new MutationObserver(()=>{ if ($('#workspace').hidden) close(); }).observe($('#workspace'),{attributes:true,attributeFilter:['hidden']});
})();
