/* Shared simulation policy. Enum values are an integration proposal until ABI is confirmed. */
(function(root){
  'use strict';
  const RiskLevel=Object.freeze({UNKNOWN:0,GREEN:1,WATCH:2,YELLOW:3,ORANGE:4,RED:5});
  const Action=Object.freeze({DEPOSIT_COLLATERAL:0,BORROW:1,REPAY:2,WITHDRAW_COLLATERAL:3});
  const names=Object.keys(RiskLevel);
  function effectiveLevel(record,now=Math.floor(Date.now()/1000)){
    if(!record||!Number.isInteger(record.validUntil)||!Number.isInteger(record.updatedAt)||record.updatedAt<0||record.validUntil<=record.updatedAt||record.validUntil<=now||record.updatedAt>now||!names.includes(record.riskLevel))return 'UNKNOWN';
    return record.riskLevel;
  }
  function policy(level,lastLtvBps=4500){
    const ltv={GREEN:7500,WATCH:7500,YELLOW:6000,ORANGE:4500,RED:4500,UNKNOWN:Math.min(4500,lastLtvBps)};
    return {level,ltvBps:ltv[level]??4500,borrow:['GREEN','WATCH','YELLOW'].includes(level),depositCollateral:['GREEN','WATCH','YELLOW','ORANGE'].includes(level),repay:true,withdrawCollateral:true};
  }
  // Integer cents and basis points; BigInt prevents rounding above the permitted limit.
  function capacity(collateralCents,priceBps,ltvBps){return Number(BigInt(collateralCents)*BigInt(priceBps)*BigInt(ltvBps)/100000000n);}
  function validate(action,n,s,p){
    if(!Number.isSafeInteger(n)||n<=0)return '请输入大于 0 的金额，最多两位小数。';
    if(action==='borrow'){
      if(!p.borrow)return `${p.level} 策略禁止新增借款。`;
      if(n>s.poolLiquidity)return '示例借贷池可用流动性不足。';
      if(s.debt+n>capacity(s.collateral,s.priceBps,p.ltvBps))return '借款后将超过当前 LTV 允许的额度。';
    }else if(action==='repay'){
      if(n>s.debt)return '还款金额超过当前债务。';
      if(n>s.walletDebt)return '模拟 dUSD 钱包余额不足。';
    }else if(action==='depositCollateral'){
      if(!p.depositCollateral)return `${p.level} 策略禁止新增抵押。`;
      if(n>s.walletCollateral)return '模拟 mUSD 钱包余额不足。';
    }else if(action==='withdrawCollateral'){
      if(n>s.collateral)return '提取金额超过已抵押余额。';
      if(s.debt>capacity(s.collateral-n,s.priceBps,p.ltvBps))return '提取后抵押不足：请先还款，或减少提取金额。';
    }else return '未知操作。';
    return '';
  }
  function apply(action,n,s,p){
    const error=validate(action,n,s,p);if(error)return {ok:false,error};
    if(action==='borrow'){s.debt+=n;s.walletDebt+=n;s.poolLiquidity-=n;}
    if(action==='repay'){s.debt-=n;s.walletDebt-=n;s.poolLiquidity+=n;}
    if(action==='depositCollateral'){s.collateral+=n;s.walletCollateral-=n;}
    if(action==='withdrawCollateral'){s.collateral-=n;s.walletCollateral+=n;}
    return {ok:true};
  }
  const api=Object.freeze({RiskLevel,Action,effectiveLevel,policy,capacity,validate,apply});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SentinelPolicy=api;
})(typeof globalThis!=='undefined'?globalThis:this);
