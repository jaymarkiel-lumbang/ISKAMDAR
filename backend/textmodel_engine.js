// ISKAMDAR text engine for the browser. Mirrors common.py preprocess() + sklearn TfidfVectorizer + LogisticRegression.
// train_text.py appends the trained model data and writes textmodel.js. If you change preprocess() in common.py,
// change it here too, then re-run train_text.py (it checks that both give the same scores).
// ISKAMDAR text engine: same steps as common.py + TfidfVectorizer(1,2) + logistic regression
const URL_RE = /(https?:\/\/\S+|www\.\S+|\b[\w-]+\.(?:com|net|org|ph|xyz|top|vip|club|site|online|link|co)\b\S*)/gi;
const PHONE_RE = /(\+?63|0)9\d{9}\b|\b9\d{9}\b/g;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const LEET = {"@":"a","0":"o","$":"s","!":"i"};
function preprocess(text){
  let t = String(text);
  t = t.replace(EMAIL_RE," <email> ").replace(PHONE_RE," <phone> ");
  t = t.replace(URL_RE," <url> ");
  t = t.replace(/\S+/g, w => {
    if (/[A-Za-z]/.test(w) && /[@0$]/.test(w) && !/\d[1-9]|[1-9]\d/.test(w))
      return w.replace(/[@0$!]/g, c => LEET[c]);
    return w;
  });
  t = t.toLowerCase();
  t = t.replace(/\d[\d,.]*/g," <num> ");
  t = t.replace(/[^\p{L}\p{N}_<>\s']/gu," ");
  return t.replace(/\s+/g," ").trim();
}
function tokens(norm){ return norm.match(/[\p{L}\p{N}_]{2,}/gu) || []; }
function makeScorer(M){
  const index = new Map(M.terms.map((t,i)=>[t,i]));
  return function score(text){
    const norm = preprocess(text), tk = tokens(norm);
    const counts = new Map();
    const add = g => { const i = index.get(g); if (i !== undefined) counts.set(i,(counts.get(i)||0)+1); };
    tk.forEach(add);
    for (let i=0;i<tk.length-1;i++) add(tk[i]+" "+tk[i+1]);
    let norm2 = 0; const vals = [];
    counts.forEach((c,i)=>{ const v=(1+Math.log(c))*M.idf[i]; vals.push([i,v]); norm2+=v*v; });
    const n = Math.sqrt(norm2) || 1;
    let z = M.intercept; const contrib = [];
    vals.forEach(([i,v])=>{ const x=v/n, c=M.coef[i]*x; z+=c; contrib.push({term:M.terms[i], c}); });
    const p = 1/(1+Math.exp(-z));
    return {p, score: Math.round(100*p), z, contrib, hasUrl: /<url>/.test(norm), known: vals.length};
  };
}
