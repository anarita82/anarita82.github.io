const estimateForm = document.querySelector('#estimate-form');
estimateForm?.addEventListener('change', () => {
  const extras = [...estimateForm.querySelectorAll('input:checked')]
    .reduce((total, input) => total + Number(input.value), 0);
  document.querySelector('#estimate-total').textContent = (7000 + extras).toLocaleString('ko-KR') + '원';
});

const checklistKey = 'oxpc-parcel-checklist-v1';
const checkboxes = [...document.querySelectorAll('[data-check]')];
let saved = {};
try {
  const parsed = JSON.parse(localStorage.getItem(checklistKey) || '{}');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
} catch {
  document.querySelector('#storage-status').textContent = '이 기기에서 체크 상태를 저장할 수 없습니다.';
}
function updateProgress() {
  document.querySelector('#checklist-progress').textContent = checkboxes.filter((input) => input.checked).length + ' / 4 완료';
}
function saveChecklist() {
  try {
    localStorage.setItem(checklistKey, JSON.stringify(Object.fromEntries(checkboxes.map((input) => [input.dataset.check, input.checked]))));
  } catch {
    document.querySelector('#storage-status').textContent = '이 기기에서 체크 상태를 저장할 수 없습니다.';
  }
  updateProgress();
}
checkboxes.forEach((input) => {
  input.checked = saved[input.dataset.check] === true;
  input.addEventListener('change', saveChecklist);
});
updateProgress();
document.querySelector('#reset-checklist')?.addEventListener('click', () => {
  checkboxes.forEach((input) => { input.checked = false; });
  saveChecklist();
});
document.querySelector('#copy-address')?.addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#delivery-address').innerText);
    status.textContent = '택배 주소가 복사되었습니다.';
  } catch {
    status.textContent = '주소를 복사하지 못했습니다. 위 주소를 길게 눌러 선택해 주세요.';
  }
});
