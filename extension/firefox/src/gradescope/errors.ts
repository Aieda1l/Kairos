export class GradescopeParseError extends Error {
  constructor(message:string){
    super(message);
    this.name="GradescopeParseError";
  }
}
