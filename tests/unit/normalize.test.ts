import { expect, it } from "vitest";
import { normalizeSourceAssignment } from "@/lib/assignments/normalize";
it("normalizes a source assignment without inventing metadata",()=>{expect(normalizeSourceAssignment("canvas",{externalId:"x",courseId:null,courseName:"Canvas",title:"HW",dueAt:null,status:"unknown",sourceUrl:null,sourceUpdatedAt:null})).toEqual({source:"canvas",externalId:"x",courseId:null,courseName:"Canvas",title:"HW",dueAt:null,status:"unknown",sourceUrl:null,sourceUpdatedAt:null});});
