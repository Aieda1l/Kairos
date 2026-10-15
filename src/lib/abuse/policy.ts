import "server-only";
import {AbuseConfigurationError,AbuseSubjectError,type AbusePolicy,type RateBudget,type RateClass,type RateSubject} from "./types";

export const DEFAULT_ABUSE_POLICY:AbusePolicy=Object.freeze({
  "auth-initiation":Object.freeze({limit:20,windowSeconds:600}),
  credential:Object.freeze({limit:10,windowSeconds:600}),
  "source-sync":Object.freeze({limit:12,windowSeconds:600}),
  "calendar-sync":Object.freeze({limit:12,windowSeconds:600}),
  "sync-all":Object.freeze({limit:6,windowSeconds:600}),
  deletion:Object.freeze({limit:5,windowSeconds:3600}),
});

export function validBudget(value:unknown):value is RateBudget{
  if(typeof value!=="object"||value===null)return false;
  const budget=value as RateBudget;
  return Number.isInteger(budget.limit)&&budget.limit>=1&&budget.limit<=1000
    &&Number.isInteger(budget.windowSeconds)&&budget.windowSeconds>=1&&budget.windowSeconds<=3600;
}

// Only Worker bindings/server environment can supply this bounded JSON map.
export function policyFromEnvironment(env:Record<string,unknown>):AbusePolicy{
  const encoded=env.KAIROS_ABUSE_BUDGETS;
  if(encoded===undefined||encoded==="")return DEFAULT_ABUSE_POLICY;
  if(typeof encoded!=="string"||encoded.length>4096)throw new AbuseConfigurationError();
  try{
    const overrides:unknown=JSON.parse(encoded);
    if(typeof overrides!=="object"||overrides===null||Array.isArray(overrides))throw new AbuseConfigurationError();
    const result={...DEFAULT_ABUSE_POLICY};
    for(const [name,budget] of Object.entries(overrides)){
      if(!Object.hasOwn(DEFAULT_ABUSE_POLICY,name)||!validBudget(budget)
        ||Object.keys(budget).length!==2)throw new AbuseConfigurationError();
      result[name as RateClass]=Object.freeze({limit:budget.limit,windowSeconds:budget.windowSeconds});
    }
    return Object.freeze(result);
  }catch{throw new AbuseConfigurationError();}
}

export function budgetForSubject(subject:RateSubject,policy:AbusePolicy=DEFAULT_ABUSE_POLICY):RateBudget{
  if(!subject||!Object.hasOwn(DEFAULT_ABUSE_POLICY,subject.class))throw new AbuseSubjectError();
  const budget=policy[subject.class];
  if(!validBudget(budget))throw new AbuseConfigurationError();
  return {limit:budget.limit,windowSeconds:budget.windowSeconds};
}
