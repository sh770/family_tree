// apply-update.mjs
// מריץ batch של פעולות (שנשלף מגוף ה-issue) על data/family-tree.json
// שימוש: node scripts/apply-update.mjs path/to/batch.json
//
// כל תאריך מסונכרן מחדש כאן באופן סמכותי דרך ספריית hebcal, כדי שהקובץ
// הסופי תמיד יהיה עקבי בין הלוח העברי ללועזי - גם אם הלקוח שלח רק צד אחד.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { HDate, gematriya } from '@hebcal/core';

const DATA_PATH = new URL('../data/family-tree.json', import.meta.url);

const HEB_MONTH_BASE = {1:'ניסן',2:'אייר',3:'סיוון',4:'תמוז',5:'אב',6:'אלול',7:'תשרי',8:'חשוון',9:'כסלו',10:'טבת',11:'שבט',12:'אדר',13:'אדר ב׳'};
function hebMonthLabel(m, isLeap){ if(m===12 && isLeap) return 'אדר א׳'; return HEB_MONTH_BASE[m]; }
function hebDisplay(hd){
  const isLeap = HDate.isLeapYear(hd.getFullYear());
  return `${gematriya(hd.getDate())} ב${hebMonthLabel(hd.getMonth(), isLeap)} ${gematriya(hd.getFullYear())}`;
}
function toISO(d){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// מקבל אובייקט payload ושם שדה (prefix, לדוגמה "birth"), ומחזיר את השדות
// המסונכרנים: {[prefix]Source, [prefix]Greg, [prefix]HebDay, [prefix]HebMonth, [prefix]HebYear, [prefix]HebDisplay}
function syncDateFields(payload, prefix){
  const source = payload[prefix + 'Source'];
  const out = {};
  if (source === 'greg' && payload[prefix + 'Greg']) {
    const d = new Date(payload[prefix + 'Greg'] + 'T00:00:00');
    if (isNaN(d)) throw new Error(`תאריך לועזי לא תקין עבור ${prefix}`);
    const hd = new HDate(d);
    out[prefix + 'Source'] = 'greg';
    out[prefix + 'Greg'] = payload[prefix + 'Greg'];
    out[prefix + 'HebDay'] = hd.getDate();
    out[prefix + 'HebMonth'] = hd.getMonth();
    out[prefix + 'HebYear'] = hd.getFullYear();
    out[prefix + 'HebDisplay'] = hebDisplay(hd);
  } else if (source === 'heb' && payload[prefix + 'HebDay'] && payload[prefix + 'HebMonth'] && payload[prefix + 'HebYear']) {
    const day = Number(payload[prefix + 'HebDay']);
    const month = Number(payload[prefix + 'HebMonth']);
    const year = Number(payload[prefix + 'HebYear']);
    const hd = new HDate(day, month, year);
    out[prefix + 'Source'] = 'heb';
    out[prefix + 'Greg'] = toISO(hd.greg());
    out[prefix + 'HebDay'] = day;
    out[prefix + 'HebMonth'] = month;
    out[prefix + 'HebYear'] = year;
    out[prefix + 'HebDisplay'] = hebDisplay(hd);
  } else {
    out[prefix + 'Source'] = '';
    out[prefix + 'Greg'] = '';
    out[prefix + 'HebDay'] = null;
    out[prefix + 'HebMonth'] = null;
    out[prefix + 'HebYear'] = null;
    out[prefix + 'HebDisplay'] = '';
  }
  return out;
}

function uid(prefix) { return prefix + '_' + crypto.randomBytes(5).toString('hex'); }

function loadBatch(argPath) {
  if (!argPath) { console.error('חסר נתיב לקובץ ה-batch'); process.exit(1); }
  const batch = JSON.parse(fs.readFileSync(argPath, 'utf-8'));
  if (!Array.isArray(batch)) throw new Error('ה-payload חייב להיות מערך של פעולות');
  return batch;
}
function loadData() { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')); }
function saveData(data) { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8'); }
function resolveId(id, idMap) { if (!id) return id; return idMap.has(id) ? idMap.get(id) : id; }

function applyBatch(data, batch) {
  const idMap = new Map();
  const log = [];

  for (const op of batch) {
    if (op.type === 'addPerson') {
      const realId = uid('p');
      if (op.payload.tempId) idMap.set(op.payload.tempId, realId);
      data.persons.push({
        id: realId,
        firstName: op.payload.firstName || '',
        lastName: op.payload.lastName || '',
        gender: op.payload.gender || 'M',
        isRoot: !!op.payload.isRoot,
        alive: op.payload.alive !== false,
        ...syncDateFields(op.payload, 'birth'),
        ...syncDateFields(op.payload, 'death')
      });
      log.push(`נוסף/ה: ${op.payload.firstName} ${op.payload.lastName}`);
    }
  }
  for (const op of batch) {
    if (op.type === 'addRelationship') {
      const a = resolveId(op.payload.a, idMap);
      const b = resolveId(op.payload.b, idMap);
      if (!a || !b || a === b) throw new Error('קשר בני זוג לא תקין: חסר צד אחד או שני הצדדים זהים');
      const realId = uid('r');
      if (op.payload.tempId) idMap.set(op.payload.tempId, realId);
      data.relationships.push({
        id: realId, a, b,
        status: op.payload.status || 'married',
        ...syncDateFields(op.payload, 'marriage'),
        ...syncDateFields(op.payload, 'divorce')
      });
      log.push(`נוסף קשר בני זוג: ${a} + ${b}`);
    }
  }
  for (const op of batch) {
    if (op.type === 'addChild') {
      const relationshipId = resolveId(op.payload.relationshipId, idMap);
      const personId = resolveId(op.payload.personId, idMap);
      if (!relationshipId || !personId) throw new Error('הוספת ילד/ה לא תקינה: חסר זוג הורים או חסר האדם');
      data.children.push({ id: uid('c'), relationshipId, personId });
      log.push(`נוסף/ה ילד/ה ${personId} לזוג ${relationshipId}`);
    }
  }
  for (const op of batch) {
    if (op.type === 'editPerson') {
      const personId = resolveId(op.payload.personId, idMap);
      const person = data.persons.find(p => p.id === personId);
      if (!person) throw new Error(`אדם לעדכון לא נמצא: ${personId}`);
      if (op.payload.alive === 'true') person.alive = true;
      if (op.payload.alive === 'false') person.alive = false;
      if (op.payload.deathSource) Object.assign(person, syncDateFields(op.payload, 'death'));
      log.push(`עודכן/ה: ${personId}`);
    }
  }
  return log;
}

const batch = loadBatch(process.argv[2]);
const data = loadData();
const log = applyBatch(data, batch);
saveData(data);
console.log('בוצע בהצלחה:\n' + log.join('\n'));
