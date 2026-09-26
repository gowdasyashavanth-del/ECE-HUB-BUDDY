import { useSearchParams } from "react-router-dom";
import { looksLikeUuid, parseFocus } from "../../lib/study";
import { StudyHome } from "../../components/study/StudyHome";
import { StudyOutline } from "../../components/study/StudyOutline";
import { StudyWorkspace } from "../../components/study/StudyWorkspace";
import { NotFound } from "../../components/study/StudyParts";

// /student/study                      → subject picker
// /student/study?subject=<id>         → unit / topic outline
// /student/study?...&topic=<id>       → topic workspace
//
// The query string is navigation state only. The unit id is never used at
// all (the database derives it from the topic); subject and topic ids are
// re-validated by the database on every load.
export function StudyModePage() {
  const [params] = useSearchParams();
  const topic = params.get("topic");
  const subject = params.get("subject");

  if (topic !== null) {
    return looksLikeUuid(topic) ? <StudyWorkspace topicId={topic} focus={parseFocus(params.get("focus"))} /> : <NotFound what="topic" />;
  }
  if (subject !== null) {
    return looksLikeUuid(subject) ? <StudyOutline subjectId={subject} /> : <NotFound what="subject" />;
  }
  return <StudyHome />;
}
