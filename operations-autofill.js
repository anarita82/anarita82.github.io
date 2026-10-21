'use strict';
window.smAutofill = (() => {
  const unique = values => [...new Set(values)];
  function suggest(result) {
    const fields={};
    if (!result || Number(result.confidence)<70) return fields;
    const names=unique((result.senders || []).filter(s=>s.source.startsWith('보내는 분')).map(s=>s.value));
    if (Number(result.confidence)>=80 && names.length===1) fields.customer=names[0];
    const text=String(result.text || '').normalize('NFKC');
    const models=unique(Array.from(text.matchAll(/\bG\s*(\d{3,4})\b/gi),m=>'G'+m[1]));
    if (models.length===1) fields.model=models[0];
    const quantities=unique(Array.from(text.matchAll(/(?:마우스\s*(?:입고\s*)?수량|입고\s*수량|수리\s*수량)\s*[:：]?\s*(\d{1,5})\s*(?:개|대)/g),m=>Number(m[1])).filter(n=>n>=1 && n<=10000));
    if (quantities.length===1) fields.quantity=String(quantities[0]);
    const dates=[];
    const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    lines.forEach((line,index)=>{
      const match=/(?:실제\s*)?(?:입고일|도착일)\s*[:：]?\s*(.*)/.exec(line);
      if (!match) return;
      const value=match[1] || lines[index+1] || '';
      dates.push(...window.smOcr.parse(value).dates);
    });
    if (unique(dates).length===1) fields.receivedDate=dates[0];
    return fields;
  }
  function plan(result,current,edited=[]) {
    const fields=suggest(result),dirty=new Set(edited),updates={};
    if (fields.customer && !dirty.has('customer') && !current.customer.trim()) updates.customer=fields.customer;
    if (fields.receivedDate && !dirty.has('received-date')) updates['received-date']=fields.receivedDate;
    if (fields.quantity && !dirty.has('received-quantity')) updates['received-quantity']=fields.quantity;
    if (fields.model && !dirty.has('model') && !dirty.has('other-model')) {
      updates.model=fields.model==='G102'?'G102':'other';
      updates['other-model']=fields.model==='G102'?'':fields.model;
    }
    return updates;
  }
  return {suggest,plan};
})();
