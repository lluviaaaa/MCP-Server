# Choosing a demo task that is YOURS

Your course rule: the idea must come from you, and be as unique and interesting as you can make it. This page gives
you criteria, a method and idea seeds. It deliberately does **not** pick for you. Whatever you choose, you will be asked
why, so make it something you actually care about.

## 1. What every good demo task must do

1. **Multi-step:** at least three phases (for example plan, build, review), not one big request.
2. **Needs memory:** session 2 truly cannot succeed without what session 1 left behind. That is what the handoff files prove.
3. **Reads before writes:** there is existing content to read first (your notes, a draft, a small buggy program).
4. **Splits into roles:** a planner or reviewer who only reads, and a coder who also writes.
5. **Leaves visible artifacts:** files you can open, plus a git history.
6. **Checkable by you:** you can tell, in two minutes, whether the result is right.
7. **Small enough:** about 25 tool calls or fewer per session, because Claude Free has message limits.
8. **Safe:** no passwords, no personal data, nothing you would regret on a projector.

**Important design fact:** this server has **no "run code" tool, on purpose** (a shell tool would make the sandbox almost
pointless). Agents can read and write files but cannot execute them. So choose tasks whose result *you* verify by opening a
file or running it yourself. That is a trade-off worth mentioning in your report.

**Also:** use the agents on your *own* notes and tools. Do not have them produce work you must hand in as your own.

## 2. A 10-minute method to find your idea

Answer these in a notebook, quickly, without judging:

1. **What did I struggle with this month?** (organizing notes, remembering deadlines, debugging, planning a group event...)
2. **What do I already have as files?** (lecture notes, a small Python project, a recipe list, game ideas, a budget sheet)
3. **What would I show a friend and be proud of?**

Then combine three ingredients into one sentence, the **twist formula**:

> *[A real thing from my life]* + *[a file-based output]* + *[a twist nobody else will have]*

Examples of twists: it measures something; it compares two ways of working; it has a rule agents must obey; it adapts
to a constraint (a tight budget, a short deadline); it has a personality or theme.

## 3. Idea seeds (pick one, mix two, or invent your own)

| Seed | What the agents do | Twist you could add |
|------|--------------------|---------------------|
| **Exam survival kit** | turn your raw notes into summaries, flashcards (CSV) and a practice quiz page | a "weak topics" file the reviewer updates after each session |
| **Bug hunt lab** | you plant bugs in a small Python program; the reviewer finds them by reading, the coder fixes them | you score how many bugs were found and how many tool calls it took |
| **Study schedule engine** | build a week-by-week plan from your syllabus and deadlines | the plan re-balances itself when a deadline moves (session 2 receives the change) |
| **Text adventure** | design a world, write the rooms and logic in HTML or Python, test paths | the reviewer plays it on paper and files dead-end bugs |
| **Recipe book + grocery planner** | collect recipes in Markdown, then generate shopping lists | a budget cap the coder must respect |
| **Club or event planner** | tasks, budget, timeline and announcements in files | roles map to real jobs (secretary, treasurer) |
| **Personal knowledge base** | link your notes together, find duplicates, build an index | a "what changed since last session" digest from git |
| **Documentation doctor** | take a small project and write its README and docs, then audit them against the code | reviewer checks every claim against a file and line |
| **Portfolio page** | plan, build and refine a personal web page | a design brief the reviewer grades against |
| **Habit or journal digest** | daily Markdown entries become weekly summaries | the summary format evolves via DECISIONS.md |
| **Game balance lab** | a CSV of units or cards; agents propose and test balance changes on paper | each change is a commit with a reason |
| **Language learning pack** | vocabulary lists, example sentences, a quiz file | spaced-repetition due dates in a file |

## 4. Two fully worked examples (to show the level of detail, not to copy)

### Example A: Exam survival kit

| Session | Role | Task | Leaves behind |
|---------|------|------|---------------|
| 1 | coder | read the 5 note files, write one summary per file, commit | summaries, `PROJECT_STATE` with "next: flashcards" |
| 2 | reviewer | read summaries against the notes, list gaps and wrong claims in DECISIONS | a prioritised list in `PLAN_LOG` |
| 3 | coder | fix the top gaps, generate `flashcards.csv` and `quiz.md`, commit | final files, a CHECKPOINT saying how you verified them |

*Acceptance criteria (written in `PROJECT_STATE.md` by session 1):* one summary per note file; at least 20 flashcards;
a quiz of 10 questions with answers; every card traceable to a note file. *Why it is multi-session:* the reviewer's gap
list is the only way session 3 knows what to fix.

### Example B: Bug hunt lab (plays to your Python strength)

You write a 60-line Python program (a gradebook, a tiny inventory system) with **six bugs you planted and wrote down privately**.

| Session | Role | Task |
|---------|------|------|
| 1 | reviewer | read the code, list suspected bugs with file and line in DECISIONS (it cannot edit anything) |
| 2 | coder | new chat, `read_handoff`, fix the confirmed bugs, commit each fix separately |
| You | | run the program yourself, compare against your private bug list |

*Your measurable results:* bugs found out of six, false alarms, tool calls per session, whether the second session
repeated work. That is real, original data for your report. Agents cannot run code, so *you* are the test runner, and you can say why.

## 5. A twist that makes any idea more interesting: the control experiment

Run the same session 2 **twice**: once starting with `read_handoff`, once starting from nothing ("continue the project").
Compare the two transcripts (`npm run transcript`): calls used, mistakes, repeated reads, whether it contradicted
session 1. You will have *evidence* that the handoff protocol works, which beats saying so. Keep both transcripts.

## 6. Make it yours (fill this in, then tell me or your instructor)

1. **The problem:** ______________________________________________
2. **The files involved:** ______________________________________
3. **"Done" means (acceptance criteria, three checks):** ____________
4. **Roles and sessions:** _______________________________________
5. **What I will measure:** _____________________________________
6. **My twist:** _______________________________________________
7. **A tool of my own that would help (see `docs/UNDERSTAND_AND_EXTEND.md`):** ______________

## 7. Describing your idea in the report (three sentences)

*"I wanted [real problem]. I used my file server to [what agents did across N sessions with roles X and Y], and I
measured [metric]. What is different about my version is [twist], and the part I built myself is [own tool or experiment]."*
