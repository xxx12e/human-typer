const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Input extends EventTarget {
  constructor() { super(); this._value=''; this.type='text'; this.selectionStart=0; this.selectionEnd=0;
    this.isConnected=true; this.disabled=false; this.readOnly=false; this.maxLength=-1; }
  get value(){return this._value} set value(v){this._value=v}
  setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b}
  focus(){}
}
class Textarea extends Input {}
Object.defineProperty(Textarea.prototype,'value',Object.getOwnPropertyDescriptor(Input.prototype,'value'));
class FakeInputEvent extends Event { constructor(type,o){super(type,o);this.inputType=o.inputType;this.data=o.data} }
const target=new Textarea(), document=new EventTarget();document.activeElement=target;
const queue=[];
const context=vm.createContext({document,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,InputEvent:FakeInputEvent,
  AbortController,Intl,Math,setTimeout:(fn)=>{queue.push(fn);return queue.length},clearTimeout:()=>{}});
// Simulate an engine left by the previous extension version; no sanitizer global exists.
context.__edgeHumanTyper={version:'1.6.0',stop(){this.stopped=true}};
vm.runInContext(fs.readFileSync(path.join(root, 'typist.js'),'utf8'),context);
assert.equal(context.__edgeHumanTyper.version,'1.1.0');
context.__edgeHumanTyper.start({text:'A\u200b🙂 B.',min:20,max:20,typoRate:0,pauseRate:0,punctuation:false,rhythm:false,sanitizedCount:0});
let guard=0;while(queue.length){assert.ok(guard++<50);queue.shift()()}
assert.equal(target.value,'A B.');
console.log('PASS engine replaces stale version and sanitizes without external global');
