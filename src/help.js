'use strict';
/*
 * Help knowledge base retrieval.
 * Deterministic keyword retrieval over data/help_kb.json — the same
 * philosophy as the rest of the app: facts come from the documents in code;
 * the model (when live) only phrases the retrieved article content.
 */
const fs = require('fs');
const path = require('path');

const KB_PATH = path.join(__dirname, '..', 'data', 'help_kb.json');
let articles = [];
try { articles = JSON.parse(fs.readFileSync(KB_PATH, 'utf8')); } catch (_) { articles = []; }

const STOPWORDS = new Set(('a an the and or of to in on for is are do does did how what why when where which who can i you it its this that with from by at be been was were will would should could my me we our your their they them he she his her as so if then than too very just about into over under again once here there all any both each more most other some such no not only own same don now').split(' '));

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9-]+/).filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

function scoreArticle(article, tokens) {
  const titleTokens = new Set(tokenize(article.title));
  const keywordTokens = new Set((article.keywords || []).flatMap(k => tokenize(k)));
  const bodyTokens = tokenize(article.body);
  const bodySet = new Set(bodyTokens);
  let score = 0;
  let distinct = 0;
  for (const t of tokens) {
    let hit = 0;
    if (titleTokens.has(t)) hit += 3;
    if (keywordTokens.has(t)) hit += 2;
    if (bodySet.has(t)) hit += 1;
    if (hit > 0) distinct += 1;
    score += hit;
  }
  return { score, distinct };
}

// Returns up to `limit` articles, best first. An article matches when at
// least two distinct query tokens hit it, or one token hits it very strongly
// (title + keywords + body) — this keeps generic one-word overlaps (like
// "today") from producing false "covered" answers.
function search(question, limit = 2) {
  const tokens = [...new Set(tokenize(question))];
  if (!tokens.length) return [];
  return articles
    .map(a => ({ article: a, ...scoreArticle(a, tokens) }))
    .filter(r => r.distinct >= 2 || r.score >= 6)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(r => r.article);
}

function topics() {
  return articles.map(a => ({ id: a.id, title: a.title }));
}

module.exports = { search, topics, count: articles.length };
