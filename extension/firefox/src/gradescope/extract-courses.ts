import type { GradescopeCourseV1 } from "@/lib/extension-protocol/gradescope";
import { GradescopeParseError } from "./errors";

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

    for(const term of Array.from(child.querySelectorAll(".courseList--term"))){
      const metadata=termMetadata(term);
      for(const anchor of directChildren(term,"A")){
        const href=anchor.getAttribute("href")??"";
        const match=href.match(/^\/courses\/(\d+)(?:[/?#]|$)/);
        if(!match)continue;
        const shortName=anchor.querySelector(".courseBox--shortname")?.textContent?.trim()||null;
        const fullName=anchor.querySelector(".courseBox--name")?.textContent?.trim();
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
  }

  if(!sawCourseSection)throw new GradescopeParseError("Gradescope account page structure was not recognized.");
  return courses;
}
