import type {
  GradescopeCourseV1,
  GradescopeDiscoveryDiagnosticsV1,
} from "@/lib/extension-protocol/gradescope";
import { GradescopeParseError } from "./errors";


export function inspectGradescopeAccountStructure(html:string):GradescopeDiscoveryDiagnosticsV1{
  const document=new DOMParser().parseFromString(html,"text/html");
  const root=document.querySelector("div#account-show");
  const headingCounts={courses:0,studentCourses:0,instructorCourses:0,other:0};
  for(const heading of Array.from(root?.querySelectorAll("h2.pageHeading")??[])){
    const text=heading.textContent?.trim()??"";
    if(text==="Courses")headingCounts.courses++;
    else if(text==="Student Courses")headingCounts.studentCourses++;
    else if(text==="Instructor Courses")headingCounts.instructorCourses++;
    else headingCounts.other++;
  }
  return {
    accountRootDetected:Boolean(root),
    createCourseControlDetected:Boolean(document.querySelector("button.js-createNewCourse")),
    headings:headingCounts,
    courseListDescendantCount:root?.querySelectorAll(".courseList").length??0,
    courseListDirectCount:root
      ?Array.from(root.children).filter(child=>child.classList.contains("courseList")).length
      :0,
    termDescendantCount:root?.querySelectorAll(".courseList--term").length??0,
    courseAnchorDescendantCount:root?.querySelectorAll('a[href^="/courses/"]').length??0,
    courseHrefContainsCount:root?.querySelectorAll('a[href*="/courses/"]').length??0,
    shortNameNodeCount:root?.querySelectorAll(".courseBox--shortname").length??0,
    fullNameNodeCount:root?.querySelectorAll(".courseBox--name").length??0,
    reactPropsNodeCount:root?.querySelectorAll("[data-react-props]").length??0,
  };
}

function directChildren(element:Element,tagName:string):Element[]{
  return Array.from(element.children).filter(child=>child.tagName===tagName);
}

function termMetadata(term:Element):{term:string|null;year:string|null}{
  const heading=directChildren(term,"H3")[0]?.textContent?.trim()??"";
  if(!heading)return {term:null,year:null};
  const parts=heading.split(/\s+/);
  const last=parts.at(-1)??"";
  if(/^\d{4}$/.test(last)){
    return {term:parts.slice(0,-1).join(" ")||null,year:last};
  }
  return {term:heading,year:null};
}

export function extractGradescopeStudentCourses(html:string):GradescopeCourseV1[]{
  const document=new DOMParser().parseFromString(html,"text/html");
  const root=document.querySelector("div#account-show");
  if(!root)throw new GradescopeParseError("Gradescope account page structure was not recognized.");

  const courses:GradescopeCourseV1[]=[];
  const isStaff=Boolean(document.querySelector("button.js-createNewCourse"));
  let studentSection=!isStaff;
  let sawCourseSection=false;

  for(const child of Array.from(root.children)){
    if(child.matches("h2.pageHeading")){
      const heading=child.textContent?.trim()??"";
      if(heading==="Student Courses")studentSection=true;
      else if(heading==="Instructor Courses")studentSection=false;
      continue;
    }
    if(!child.classList.contains("courseList"))continue;
    sawCourseSection=true;
    if(!studentSection)continue;

    let metadata:{term:string|null;year:string|null}|null=null;
    for(const node of Array.from(
      child.querySelectorAll('.courseList--term, a[href^="/courses/"]'),
    )){
      if(node.classList.contains("courseList--term")){
        metadata=termMetadata(node);
        continue;
      }
      if(!metadata||node.tagName!=="A")continue;
      const href=node.getAttribute("href")??"";
      const match=href.match(/^\/courses\/(\d+)(?:[/?#]|$)/);
      if(!match)continue;
      const shortName=node.querySelector(".courseBox--shortname")?.textContent?.trim()||null;
      const fullName=node.querySelector(".courseBox--name")?.textContent?.trim();
      if(!fullName)continue;
      courses.push({
        courseId:match[1],
        shortName,
        fullName,
        term:metadata.term,
        year:metadata.year,
      });
    }
  }

  if(!sawCourseSection)throw new GradescopeParseError("Gradescope account page structure was not recognized.");
  return courses;
}
