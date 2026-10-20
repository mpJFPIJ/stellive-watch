export const ID = /^[A-Za-z0-9_-]{11}$/;
const decisions = new Set(['include','exclude','review','auto']);
export function validateBackup(obj) {
  if (!obj || obj.schema !== 1 || !obj.records || typeof obj.records !== 'object' || Array.isArray(obj.records)) throw Error('지원하지 않는 백업 형식');
  const records = Object.create(null);
  for (const [id, r] of Object.entries(obj.records)) {
    if (!ID.test(id) || !r || typeof r !== 'object' || Array.isArray(r)) throw Error('기록 ID/형식 오류');
    if (!Number.isFinite(r.position ?? 0) || (r.position ?? 0) < 0 || (r.position ?? 0) > 1000000) throw Error('재생 위치 오류');
    if (r.manual !== undefined && !decisions.has(r.manual)) throw Error('분류 오류');
    if (r.completed !== undefined && typeof r.completed !== 'boolean') throw Error('완료 상태 오류');
    if (!Number.isFinite(r.updated ?? 0) || (r.updated ?? 0)<0 || (r.updated ?? 0)>8640000000000000) throw Error('갱신 시각 오류');
    records[id]={position:r.position ?? 0, completed:r.completed ?? false, updated:r.updated ?? 0, ...(r.manual ? {manual:r.manual} : {})};
  }
  return records;
}
export function mergeRecords(existing, incoming) {
  const merged = {...existing};
  for (const [id,row] of Object.entries(incoming)) {
    const old=existing[id];
    merged[id]=!old ? row : {...(old.updated > row.updated ? row : old), ...(old.updated > row.updated ? old : row), completed:old.completed || row.completed};
  }
  return merged;
}
export function syncRecords(existing,incoming) {
  const merged={...existing};
  for(const [id,row] of Object.entries(incoming))if(!merged[id] || row.updated>=merged[id].updated)merged[id]=row;
  return merged;
}
export function classification(video,records) {
  const local=records[video.id]?.manual;
  return local==='auto' ? video.suggested : local || video.manual || video.suggested;
}
export function matches(v,records,{mode='include',channel='',query=''}={}) {
  if (channel && v.channel!==channel) return false;
  if (query && !`${v.title} ${v.published_kst || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return false;
  const kind=classification(v,records);
  return mode==='all' || (mode==='unwatched' ? kind==='include' && !records[v.id]?.completed : kind===mode);
}
export function sortVideos(rows) {
  return [...rows].sort((a,b)=>Date.parse(a.published_utc)-Date.parse(b.published_utc) || (a.id<b.id ? -1 : a.id>b.id ? 1 : 0));
}
export function kst(value) {
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value))+' KST';
}
export function originalUrl(id,position=0) {
  if(!ID.test(id)) throw Error('영상 ID 오류');
  return `https://www.youtube.com/watch?v=${id}&t=${Math.floor(Math.max(0,Number(position)||0))}s`;
}
