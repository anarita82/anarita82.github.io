'use strict';
window.smOcr = (() => {
  const senderLabel = /(?:보\s*내\s*는\s*(?:분|사\s*람)|보\s*낸\s*(?:분|사\s*람)|발\s*송\s*(?:인|자)|송\s*하\s*인|\bFROM\b)\s*[:：]?/i;
  const receiverLabel = /(?:받\s*는\s*(?:분|사\s*람)|수\s*취\s*인|수\s*령\s*인|\bTO\b)\s*[:：]?/i;
  function parse(text) {
    const lines=String(text || '').normalize('NFKC').split(/\r?\n/).map(line=>line.replace(/[\x00-\x1f\x7f]/g,' ').trim()).filter(Boolean);
    const senders=[];
    const add=(value,source)=>{
      const cleaned=value.split(receiverLabel)[0].split(/(?:연락처|전화|주소|우편번호|운송장|TEL|\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4})/i)[0]
        .replace(/^[\s:：|/]+|[\s:：|/]+$/g,'').trim();
      if (cleaned.length<2 || cleaned.length>80 || !/[가-힣a-z]/i.test(cleaned)
        || /(?:[시군구]\s+.*[로길동읍면]\s*\d|\d{3,5}[- ]\d{3,5}|년\s*\d+월)/.test(cleaned)
        || senders.some(item=>item.value===cleaned)) return;
      senders.push({value:cleaned,source});
    };
    let receiving=false;
    lines.forEach((line,index)=>{
      const match=senderLabel.exec(line);
      if (match) {
        receiving=false;
        const tail=line.slice(match.index+match[0].length);
        if (tail.trim()) add(tail,'보내는 분');
        else {
          for (const next of lines.slice(index+1,index+4)) {
            if (receiverLabel.test(next) || senderLabel.test(next)) break;
            const before=senders.length; add(next,'보내는 분 다음 줄');
            if (senders.length>before) break;
          }
        }
      } else if (receiverLabel.test(line)) receiving=true;
      else if (!receiving && /(?:PC(?:방|카페)?|피[씨시](?:방)?|피플PC)\s*$/i.test(line)) add(line,'상호 후보 · 확인 필요');
    });
    const dates=[];
    const normalized=lines.join('\n');
    const datePattern=/(?:^|[^\d])(20\d{2})\s*(?:[-./년]\s*|\s+)?(\d{1,2})\s*(?:[-./월]\s*|\s+)?(\d{1,2})(?:일)?(?!\d)/g;
    for (const match of normalized.matchAll(datePattern)) {
      const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
      const date=new Date(Date.UTC(year,month-1,day));
      if (date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) continue;
      const value=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      if (!dates.includes(value)) dates.push(value);
    }
    return {senders:senders.slice(0,8),dates:dates.slice(0,8)};
  }
  let active=null;
  let preparing=false;
  function candidate(data,rotation,enhanced=false) {
    const text=String(data.text || '').slice(0,12000);
    const confidence=Math.max(0,Math.min(100,Number(data.confidence)||0));
    const parsed=parse(text);
    // A short English fragment beside a broken sender label is not a reliable name.
    parsed.senders=parsed.senders.filter(item=>confidence>=50 && ((/[가-힣]/.test(item.value) && confidence>=70) || /PC(?:방|카페)?$/i.test(item.value) || confidence>=80));
    const letters=(text.match(/[가-힣a-z]/gi)||[]).length;
    const korean=(text.match(/[가-힣]/g)||[]).length;
    const labels=(senderLabel.test(text)?1:0)+(receiverLabel.test(text)?1:0);
    const score=confidence + Math.min(25,korean/3) + labels*12 + Math.min(8,letters/20);
    return {text,confidence,...parsed,rotation,enhanced,score};
  }
  function bestCandidate(results) {
    return results.reduce((best,item)=>!best || item.score>best.score ? item : best,null);
  }
  function cancel() {
    if (!active) return;
    active.cancelled=true;
    active.reject(new Error('문자 인식을 중지했습니다.'));
    if (active.worker) { active.worker.terminate(); active.worker=null; }
    active=null;
  }
  async function recognize(file,onProgress=()=>{}) {
    if (!['image/jpeg','image/png','image/webp'].includes(file?.type) || file.size>12000000) throw new Error('JPG·PNG·WebP 사진을 12MB 이하로 선택해 주세요.');
    if (!window.Tesseract) throw new Error('문자 인식 도구를 불러오지 못했습니다. 새로고침해 주세요.');
    if (preparing) throw new Error('인식 도구를 준비 중입니다. 잠시 후 다시 시도해 주세요.');
    cancel();
    let reject;
    const stopped=new Promise((_,fail)=>{reject=fail;});
    const job={cancelled:false,worker:null,reject}; active=job;
    let canvas,rotated;
    let pass=0;
    const timer=setTimeout(()=>{
      job.cancelled=true;
      job.reject(new Error('인식 시간이 초과되었습니다. 사진을 작게 자르거나 직접 입력해 주세요.'));
      if (job.worker) { job.worker.terminate(); job.worker=null; }
    },180000);
    const work=(async()=>{
      const bitmap=await createImageBitmap(file);
      try {
        if (bitmap.width*bitmap.height>32000000) throw new Error('사진 해상도가 너무 큽니다. 송장 부분만 잘라 다시 선택해 주세요.');
        if (job.cancelled) throw new Error('문자 인식을 중지했습니다.');
        const scale=Math.min(2,2600/Math.max(bitmap.width,bitmap.height));
        canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext('2d',{willReadFrequently:true});
        context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height);
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      } finally { bitmap.close(); }
      preparing=true;
      let worker;
      try {
        const base=new URL('./',window.location.href).href;
        worker=await window.Tesseract.createWorker(['kor','eng'],1,{
          workerPath:new URL('tesseract-worker-7.0.0.min.js',base).href,
          corePath:base, langPath:base.replace(/\/$/,''), gzip:false, cacheMethod:'none', workerBlobURL:false,
          logger:event=>{
            if (!job.cancelled) {
              const progress=Math.max(0,Math.min(1,Number(event.progress)||0));
              onProgress(event.status,event.status==='recognizing text' ? .15+(pass+progress)/5*.85 : progress*.15);
            }
          },
          errorHandler:()=>{},
        });
      } finally { preparing=false; }
      if (job.cancelled) { await worker.terminate(); throw new Error('문자 인식을 중지했습니다.'); }
      job.worker=worker;
      await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
      const results=[];
      const read=async(rotation,enhanced)=>{
        if (job.cancelled) throw new Error('문자 인식을 중지했습니다.');
        rotated=document.createElement('canvas');
        const sideways=rotation===90 || rotation===270;
        rotated.width=sideways?canvas.height:canvas.width;
        rotated.height=sideways?canvas.width:canvas.height;
        const context=rotated.getContext('2d');
        context.fillStyle='#fff';context.fillRect(0,0,rotated.width,rotated.height);
        context.translate(rotated.width/2,rotated.height/2);context.rotate(rotation*Math.PI/180);
        if (enhanced) context.filter='grayscale(1) contrast(1.5)';
        context.drawImage(canvas,-canvas.width/2,-canvas.height/2);
        onProgress(`방향 비교 ${Math.min(pass+1,4)}/4${enhanced?' · 대비 보정':''}`, .15+pass/5*.85);
        try {
          const {data}=await worker.recognize(rotated,{rotateAuto:enhanced});
          if (job.cancelled) throw new Error('문자 인식을 중지했습니다.');
          results.push(candidate(data,rotation,enhanced));
        } finally { rotated.width=0;rotated.height=0;rotated=null; }
        pass++;
      };
      for (const rotation of [0,90,180,270]) await read(rotation,false);
      await read(bestCandidate(results).rotation,true);
      onProgress('방향 비교 완료',1);
      return {...bestCandidate(results),attempts:results.length};
    })();
    try { return await Promise.race([work,stopped]); }
    catch(error) {
      if (job.cancelled) throw error;
      throw new Error('사진에서 글자를 읽지 못했습니다. 사진을 정면으로 다시 찍거나 직접 입력해 주세요.');
    } finally {
      clearTimeout(timer);
      if (job.worker) { await job.worker.terminate(); job.worker=null; }
      if (canvas) { canvas.width=0; canvas.height=0; }
      if (rotated) { rotated.width=0; rotated.height=0; }
      if (active===job) active=null;
    }
  }
  return {parse,recognize,cancel,candidate,bestCandidate};
})();
