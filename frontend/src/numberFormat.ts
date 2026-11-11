export function formatNumber(value:number|null|undefined,digits=1) {
  return value===null||value===undefined||!Number.isFinite(value)?'—':
    new Intl.NumberFormat('en-GB',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
}
