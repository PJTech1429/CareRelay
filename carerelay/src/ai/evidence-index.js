// Mechanical source indexing, not extraction or semantic interpretation.
// Index values are copied exclusively from original messages, never metadata.
export function evidenceIndex(originalMessages){
 const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
 return originalMessages.flatMap(message=>[...segmenter.segment(message.text)].map(({segment,index})=>{
  const quote=segment.trim(),leading=segment.length-segment.trimStart().length;
  return {messageId:message.id,start:index+leading,end:index+leading+quote.length,quote};
 }).filter(span=>span.quote.length>0));
}
