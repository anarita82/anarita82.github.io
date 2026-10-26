'use strict';
// This publishable key does not grant access; server RLS and the operator list do.
const SM_URL = 'https://gtauxwbyuzmpbudsnozn.supabase.co';
const SM_KEY = 'sb_publishable_FE0Ea_0FfmYY-_sEtz85TA_fXPHyguY';
async function smFetch(url, options = {}) {
  const controller = new AbortController();
  const relay = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', relay, { once:true });
  const timer = setTimeout(() => controller.abort(), 45000);
  try { return await fetch(url, { ...options, signal:controller.signal }); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', relay); }
}
const smClient = window.supabase?.createClient(SM_URL, SM_KEY, {
  auth: { persistSession: true, storage: window.sessionStorage, storageKey: 'sm-operations-auth', detectSessionInUrl: false },
  global: { fetch:smFetch },
});
const smPhotoUrls = new Map();
function smResult(result) {
  if (result.error) {
    const code = result.error.code;
    if (code === '42501') throw new Error('관리 권한이 없거나 로그인이 만료되었습니다. 다시 로그인해 주세요.');
    throw new Error('저장 또는 조회에 실패했습니다. 입력 내용과 연결 상태를 확인해 주세요.');
  }
  return result.data;
}
async function smRpc(name, data) {
  const row = smResult(await smClient.rpc(name, data));
  return Array.isArray(row) ? row[0] : row;
}
async function cloudApi(path, data) {
  if (!smClient) throw new Error('로그인 도구를 불러오지 못했습니다. 새로고침해 주세요.');
  if (path === '/api/session') {
    const { data: { session }, error } = await smClient.auth.getSession();
    if (error) throw new Error('로그인 상태를 확인하지 못했습니다.');
    const allowed = session ? smResult(await smClient.rpc('sm_is_operator')) : false;
    if (session && !allowed) {
      await smClient.auth.signOut({ scope: 'local' });
      throw new Error('승인된 관리자 계정만 사용할 수 있습니다.');
    }
    return { authenticated: Boolean(session && allowed), setup_required: false, today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()) };
  }
  if (path === '/api/login') {
    const result = await smClient.auth.signInWithPassword({ email: data.username.trim(), password: data.password });
    if (result.error) throw new Error('로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.');
    return {};
  }
  if (path === '/api/logout') {
    smResult(await smClient.auth.signOut({ scope: 'local' }));
    smPhotoUrls.clear();
    return {};
  }
  if (path === '/api/backup' && !data) return smResult(await smClient.rpc('sm_export_ledger'));
  if (path === '/api/payments' && data) return smRpc('sm_create_payment', {
    p_receipt_id:data.receipt_id,p_paid_date:data.paid_date,p_amount:data.amount,
    p_note:data.note,p_request_key:data.request_key,p_confirmed:data.confirmed,
  });
  const paymentVoid = path.match(/^\/api\/payments\/([a-f0-9-]{36})\/void$/);
  if (paymentVoid && data) return smRpc('sm_void_payment', {p_payment_id:paymentVoid[1],p_reason:data.reason,p_confirmed:data.confirmed});
  const deleted = path.match(/^\/api\/receipts\/([a-f0-9-]{36})\/deleted$/);
  if (deleted && data) return smRpc('sm_set_receipt_deleted', {p_receipt_id:deleted[1],p_deleted:data.deleted,p_confirmed:data.confirmed});
  if ((path === '/api/receipts' || path === '/api/receipts/trash') && !data) {
    const all = [];
    // Explicit pagination avoids silently dropping old intake records at the API row limit.
    for (let offset = 0; ; offset += 500) {
      let query = smClient.from('sm_receipts').select('*,sm_shipments(*),sm_payments(*)');
      query = path === '/api/receipts/trash' ? query.not('deleted_at','is',null) : query.is('deleted_at',null);
      const rows = smResult(await query.order('received_date', { ascending: false }).order('id').range(offset, offset + 499));
      all.push(...rows);
      if (rows.length < 500) break;
    }
    return all.map(row => {
      const shipments = (row.sm_shipments || []).map(s => ({ ...s, sent: Boolean(s.sent_at) })).sort((a,b) => a.sequence-b.sequence);
      const shipped = shipments.reduce((n,s) => n+s.quantity,0);
      const payments = (row.sm_payments || []).sort((a,b)=>a.paid_date.localeCompare(b.paid_date)||a.id.localeCompare(b.id));
      const paid = payments.filter(p=>!p.voided_at).reduce((n,p)=>n+Number(p.amount),0);
      return { ...row, payments, paid, balance:shipments.reduce((n,s)=>n+Number(s.total),0)-paid, shipments, shipped, remaining: row.quantity-shipped, total: shipments.reduce((n,s) => n+Number(s.total),0), photo_id: row.photo_path };
    });
  }
  if (path === '/api/receipts') return smRpc('sm_create_receipt', {
    p_customer:data.customer, p_received_date:data.received_date, p_quantity:data.quantity, p_model:data.model,
    p_photo_path:data.photo_id, p_note:data.note, p_confirmed:data.confirmed,
  });
  if (path === '/api/shipments') return smRpc('sm_create_shipment', Object.fromEntries(Object.entries(data).map(([k,v]) => ['p_'+k,v])));
  const invoice = path.match(/^\/api\/shipments\/([a-f0-9-]{36})\/invoice$/);
  if (invoice && !data) {
    const shipment = smResult(await smClient.from('sm_shipments').select('*,sm_receipts(*)').eq('id',invoice[1]).single());
    if (shipment.sm_receipts?.deleted_at) throw new Error('삭제된 입고 내역입니다. 먼저 복구해 주세요.');
    return { record:shipment.sm_receipts, shipment };
  }
  const sent = path.match(/^\/api\/shipments\/([a-f0-9-]{36})\/sent$/);
  if (sent) return smRpc('sm_mark_sent', { p_shipment_id:sent[1], p_confirmed:data.confirmed });
  throw new Error('지원하지 않는 작업입니다.');
}
async function uploadPrivatePhoto(file) {
  const extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[file.type];
  if (!extension || file.size > 12000000) throw new Error('JPG·PNG·WebP 사진을 12MB 이하로 선택해 주세요.');
  const path = 'intake/' + crypto.randomUUID() + '.' + extension;
  smResult(await smClient.storage.from('seoulmouse-private').upload(path, file, { contentType:file.type, upsert:false }));
  return path;
}
async function privatePhotoUrl(path) {
  const cached = smPhotoUrls.get(path);
  if (cached && cached.until > Date.now()) return cached.url;
  const result = smResult(await smClient.storage.from('seoulmouse-private').createSignedUrl(path, 60));
  smPhotoUrls.set(path, { url:result.signedUrl, until:Date.now()+45000 });
  return result.signedUrl;
}

