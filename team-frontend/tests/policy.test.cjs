const {test}=require('node:test'),assert=require('node:assert/strict'),P=require('../frontend/policy.js');
const position=()=>({collateral:100000,debt:20000,walletCollateral:50000,walletDebt:50000,poolLiquidity:1000000,priceBps:10000});
test('all enum mappings and expiry fail closed',()=>{
 assert.deepEqual(P.RiskLevel,{UNKNOWN:0,GREEN:1,WATCH:2,YELLOW:3,ORANGE:4,RED:5});
 for(const [level,ltv,borrow,deposit]of [['GREEN',7500,true,true],['WATCH',7500,true,true],['YELLOW',6000,true,true],['ORANGE',4500,false,true],['RED',4500,false,false],['UNKNOWN',4500,false,false]]){const p=P.policy(level);assert.equal(p.ltvBps,ltv);assert.equal(p.borrow,borrow);assert.equal(p.depositCollateral,deposit);assert.equal(p.repay,true);}
 assert.equal(P.effectiveLevel(null,100),'UNKNOWN');assert.equal(P.effectiveLevel({riskLevel:'ORANGE',updatedAt:90,validUntil:100},100),'UNKNOWN');assert.equal(P.effectiveLevel({riskLevel:'ORANGE',updatedAt:90,validUntil:101},100),'ORANGE');assert.equal(P.effectiveLevel({riskLevel:'GREEN',updatedAt:110,validUntil:150},100),'UNKNOWN');assert.equal(P.effectiveLevel({riskLevel:'GREEN',validUntil:150},100),'UNKNOWN');assert.equal(P.policy('UNKNOWN',3000).ltvBps,3000);
});
test('ORANGE blocks borrowing but permits repayment and collateral-safe withdrawal',()=>{
 const s=position();assert.equal(P.apply('borrow',10000,s,P.policy('GREEN')).ok,true);assert.equal(s.debt,30000);s.priceBps=9970;
 const before=JSON.stringify(s);assert.equal(P.apply('borrow',100,s,P.policy('ORANGE')).ok,false);assert.equal(JSON.stringify(s),before);
 assert.equal(P.apply('repay',5000,s,P.policy('ORANGE')).ok,true);assert.equal(s.debt,25000);
 assert.equal(P.apply('withdrawCollateral',10000,s,P.policy('ORANGE')).ok,true);assert.equal(s.collateral,90000);
 assert.equal(P.apply('withdrawCollateral',50000,s,P.policy('ORANGE')).ok,false);assert.equal(s.collateral,90000);
 assert.equal(P.apply('repay',25000,s,P.policy('UNKNOWN')).ok,true);assert.equal(P.apply('withdrawCollateral',90000,s,P.policy('UNKNOWN')).ok,true);
});
test('YELLOW cap, RED deposit block, invalid amounts and overpayment preserve balances',()=>{
 const s=position();assert.equal(P.capacity(s.collateral,10000,6000),60000);assert.equal(P.apply('borrow',40001,s,P.policy('YELLOW')).ok,false);assert.equal(P.apply('borrow',40000,s,P.policy('YELLOW')).ok,true);
 assert.equal(P.apply('depositCollateral',100,s,P.policy('RED')).ok,false);
 for(const n of [NaN,Infinity,-1,0,0.5,Number.MAX_SAFE_INTEGER])assert.equal(P.apply('repay',n,s,P.policy('RED')).ok,false);
 assert.equal(P.apply('repay',s.debt+1,s,P.policy('RED')).ok,false);
 assert.equal(P.apply('depositCollateral',s.walletCollateral+1,s,P.policy('GREEN')).ok,false);
});
test('capacity rounds down at the collateral boundary',()=>{
 const s=position();s.debt=44865;s.priceBps=9970;assert.equal(P.capacity(100000,9970,4500),44865);assert.equal(P.apply('withdrawCollateral',1,s,P.policy('ORANGE')).ok,false);
});
