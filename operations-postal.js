(function(){
 'use strict';
 const model=window.smPostalModel;
 const dialog=document.createElement('dialog');dialog.id='postal-dialog';dialog.setAttribute('aria-labelledby','postal-title');
 const form=document.createElement('form');dialog.append(form);
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const title=node('h2','우체국 등록파일 (.xls)');title.id='postal-title';form.append(title);
 const context=node('p');context.className='muted';form.append(context);
 const help=node('p','제공해 주신 주소록과 같은 Sheet1·22개 열의 Excel 97–2003(.xls) 파일입니다. 우체국 화면의 불러오기 호환 검증은 아직 완료되지 않았습니다.');help.className='muted';form.append(help);
 const uploadLabel=node('label','주소록 불러오기 (이 로그인 화면에서만 사용)');const upload=node('input');upload.type='file';upload.accept='.xls,.xlsx';uploadLabel.append(upload);form.append(uploadLabel);
 const importStatus=node('p');importStatus.className='muted';importStatus.setAttribute('aria-live','polite');form.append(importStatus);
 const selectLabel=node('label','주소록에서 받는 분 선택');const select=node('select');selectLabel.append(select);form.append(selectLabel);
 const inputs={};const grid=node('div');grid.className='postal-fields';
 for(const [key,label,max]of [['name','이름 또는 상호',100],['zip','우편번호',5],['address','주소1',250],['detail','주소2 (상세주소)',250],['mobile','휴대전화',20],['phone','일반전화',20]]){const l=node('label',label),input=node('input');input.type='text';input.maxLength=max;input.autocomplete='off';input.setAttribute('aria-label',label);if(key==='zip')input.inputMode='numeric';if(key==='mobile'||key==='phone')input.inputMode='tel';l.append(input);grid.append(l);inputs[key]=input;}
 form.append(grid);
 const checkLabel=node('label');checkLabel.className='check-label';const check=node('input');check.type='checkbox';check.required=true;checkLabel.append(check,document.createTextNode('이번 출고의 받는 분·주소·연락처가 맞는지 확인했습니다.'));form.append(checkLabel);
 const privacy=node('p','주소록과 입력한 배송 정보는 서버·공개 저장소에 올리지 않습니다. 화면을 새로 열거나 로그아웃하면 다시 불러와야 합니다. 내려받은 파일에는 고객 정보가 포함됩니다. 우체국 접수는 별도로 진행해 주세요.');privacy.className='muted';form.append(privacy);
 const error=node('p');error.className='error';error.setAttribute('role','alert');form.append(error);
 const actions=node('div');actions.className='dialog-actions';const close=node('button','닫기');close.type='button';close.className='secondary';const download=node('button','우체국 .xls 파일 받기');download.className='primary';actions.append(close,download);form.append(actions);document.body.append(dialog);
 let contacts=[],target=null,generation=0,active=()=>false;
 function resetOptions(){select.replaceChildren(new Option('직접 입력 또는 주소록에서 선택',''));contacts.forEach((r,i)=>select.append(new Option(r.name+' · '+r.zip+' · '+r.address,i)));}
 function clear(){generation++;contacts=[];target=null;form.reset();Object.values(inputs).forEach(n=>n.value='');upload.value='';context.textContent='';importStatus.textContent='';error.textContent='';resetOptions();if(dialog.open)dialog.close();}
 close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(!dialog.open)clear();});
 select.onchange=()=>{if(select.value==='')return;const r=contacts[Number(select.value)];if(!r)return;Object.keys(inputs).forEach(k=>inputs[k].value=r[k]);check.checked=false;error.textContent='';};
 Object.values(inputs).forEach(n=>n.addEventListener('input',()=>{check.checked=false;error.textContent='';}));
 upload.onchange=async()=>{const token=++generation;const file=upload.files[0];if(!file)return;error.textContent='';contacts=[];resetOptions();check.checked=false;
 try{if(file.size>5*1024*1024)throw Error('5MB 이하의 주소록 파일을 선택해 주세요.');if(!/\.(xls|xlsx)$/i.test(file.name))throw Error('xls 또는 xlsx 파일을 선택해 주세요.');const bytes=await file.arrayBuffer();if(token!==generation||!active()||!dialog.open)return;const wb=XLSX.read(bytes,{type:'array',cellFormula:true,bookVBA:false,sheetRows:10002});const sheet=wb.Sheets[wb.SheetNames[0]];if(!sheet)throw Error('주소록 시트가 없습니다.');const range=XLSX.utils.decode_range(sheet['!ref']||'A1');if(range.e.r>10000||range.e.c>21)throw Error('22개 열·10,000건 이하의 주소록을 선택해 주세요.');for(const [key,c]of Object.entries(sheet)){if(!key.startsWith('!')&&c?.f)throw Error('수식이 없는 주소록 파일을 사용해 주세요.');}const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false});contacts=model.parse(rows);if(token!==generation||!active()||!dialog.open)return;resetOptions();importStatus.textContent=contacts.length+'건을 불러왔습니다. 받는 분을 직접 선택해 주세요.';
 }catch(e){if(token===generation){error.textContent=e.message;importStatus.textContent='주소록을 불러오지 못했습니다. 직접 입력할 수도 있습니다.';}}finally{if(token===generation)upload.value='';}};
 form.onsubmit=e=>{e.preventDefault();if(!target||!active()){clear();return;}const r=Object.fromEntries(Object.entries(inputs).map(([k,n])=>[k,n.value.trim()]));const issues=model.validate(r);if(issues.length){error.textContent=issues.join('\n');return;}if(!check.checked){error.textContent='받는 분 정보를 확인해 주세요.';return;}try{const wb=model.workbook(XLSX,r);XLSX.writeFile(wb,model.filename(target.record,target.shipment),{bookType:'biff8'});error.textContent='';importStatus.textContent='다운로드를 요청했습니다. 이번 출고의 받는 분 1건만 포함됩니다. 우체국에 자동 접수되지는 않습니다.';}catch(e){error.textContent='파일을 만들지 못했습니다. '+e.message;}};
 window.smPostal={clear,open(record,shipment,isActive){clear();active=isActive;if(!active())return;target={record:{code:record.code},shipment:{shipped_date:shipment.shipped_date,sequence:shipment.sequence}};inputs.name.value=record.customer;context.textContent=record.customer+' · '+shipment.shipped_date+' · '+shipment.sequence+'차 출고 '+shipment.quantity+'개 / 받는 분 1건';dialog.showModal();}};
 resetOptions();
})();
