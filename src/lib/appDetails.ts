// What an app's details page says about it: a line or two on what agents
// can do with it, the kind of app it is, three things to try, and the
// colour its header is washed in. Written for the apps Bloks ships with;
// any other app from the full catalogue gets the same page built from its
// own name and line.
export interface AppDetails {
  about: string;
  category: string;
  /** Things to ask an agent, each ready to send once the app is connected. */
  prompts: string[];
  /** The app's own colour, for the header behind the prompts. */
  accent: string;
}

const D: Record<string, AppDetails> = {
  slack: {
    category: "Communication",
    accent: "#4a154b",
    about: "Agents read channels and threads, catch you up on what you missed, and post updates where your team already talks.",
    prompts: [
      "Catch me up on #general since yesterday: decisions, open questions, and anything that mentions me",
      "Draft an update for #team on this week's progress, short enough to read on a phone",
      "Find the thread where we last discussed pricing and summarise where it landed",
    ],
  },
  github: {
    category: "Developer tools",
    accent: "#24292f",
    about: "Agents triage issues, review pull requests, and keep an eye on what changed in your repositories.",
    prompts: [
      "List the open pull requests waiting on my review, oldest first, with one line on each",
      "Triage this week's new issues: label them, and flag anything that looks like a regression",
      "Summarise what merged to main since Monday, grouped by area",
    ],
  },
  gmail: {
    category: "Communication",
    accent: "#3b3fa8",
    about: "Agents summarise your inbox, draft replies in your voice, and turn long threads into something you can act on.",
    prompts: [
      "Summarise the last 5 messages in my inbox and capture decisions, open questions, and what I should follow up on next",
      "Draft a polite, firm reply to the most recent email that needs an answer from me",
      "Turn my latest customer escalation thread into an action list with owners and deadlines",
    ],
  },
  googlecalendar: {
    category: "Productivity",
    accent: "#1a62d6",
    about: "Agents look up your schedule, find time that works, and book or move meetings for you.",
    prompts: [
      "What does my week look like? Flag back to back blocks and anything I should prepare for",
      "Find three 30 minute slots next week when I am free in the afternoon",
      "Move tomorrow's 1:1s so I have a clear two hour block in the morning",
    ],
  },
  googlesheets: {
    category: "Productivity",
    accent: "#0f8a4c",
    about: "Agents read and update spreadsheets: pull numbers, clean up columns, and add the rows you would have typed by hand.",
    prompts: [
      "Read my budget sheet and tell me which categories are over for this month",
      "Add this week's results as new rows in the tracking sheet",
      "Find duplicate rows in the contacts sheet and list them for me to check",
    ],
  },
  googledocs: {
    category: "Productivity",
    accent: "#2f6fe0",
    about: "Agents draft, revise and summarise documents, and leave them where your team already works.",
    prompts: [
      "Draft a one page project brief from our last conversation and save it as a new doc",
      "Summarise the latest version of the planning doc in five bullets",
      "Tighten the intro of my draft without changing what it says",
    ],
  },
  googledrive: {
    category: "Files",
    accent: "#1c8a5a",
    about: "Agents find files across Drive, Docs, Sheets and Slides, and work with what is in them.",
    prompts: [
      "Find the most recent contract I shared and tell me when it renews",
      "List the files I edited this week, newest first",
      "Find every doc that mentions the launch date and check they all agree",
    ],
  },
  outlook: {
    category: "Communication",
    accent: "#0f5fb8",
    about: "Agents triage Outlook mail and calendar: summaries, replies, and time found or booked.",
    prompts: [
      "Triage my Outlook inbox: what needs a reply today, and what can wait",
      "Draft replies to the three oldest unanswered emails",
      "What meetings do I have tomorrow, and which have no agenda yet?",
    ],
  },
  microsoft_teams: {
    category: "Communication",
    accent: "#4b53bc",
    about: "Agents follow chats and channels, summarise meetings, and post where your team works.",
    prompts: [
      "Catch me up on the team channel since my last message",
      "Summarise yesterday's chats that mention me, with what I owe",
      "Post a short status update to the project channel",
    ],
  },
  excel: {
    category: "Productivity",
    accent: "#107c41",
    about: "Agents read and update workbooks: totals, cleanups, and new rows.",
    prompts: [
      "Read the quarterly workbook and tell me the three biggest changes since last quarter",
      "Add a summary sheet with totals by category",
      "Check the expenses workbook for entries without a category",
    ],
  },
  one_drive: {
    category: "Files",
    accent: "#0a64c2",
    about: "Agents find and organise files on OneDrive.",
    prompts: [
      "Find the latest version of the board deck",
      "List files I have not opened in a year that take up the most space",
      "Find every spreadsheet shared with me this month",
    ],
  },
  notion: {
    category: "Productivity",
    accent: "#2f2f2f",
    about: "Agents read and write pages and databases: notes, plans and trackers kept up to date.",
    prompts: [
      "Summarise my roadmap page and list what is overdue",
      "Add today's meeting notes as a new page under Meetings",
      "Find tasks in my tracker with no owner and suggest who should take them",
    ],
  },
  linear: {
    category: "Developer tools",
    accent: "#5e6ad2",
    about: "Agents track issues and cycles: triage, updates, and what is at risk this cycle.",
    prompts: [
      "What is at risk in the current cycle, and why?",
      "Triage the untriaged issues in my team and set priorities",
      "Write a cycle summary of what shipped and what slipped",
    ],
  },
  whatsapp: {
    category: "Communication",
    accent: "#128c4a",
    about: "Agents handle WhatsApp Business messages: replies, summaries, and follow-ups.",
    prompts: [
      "Summarise unanswered customer messages from today",
      "Draft replies to the questions I have not answered yet",
      "List conversations that mentioned an order problem this week",
    ],
  },
  instagram: {
    category: "Social",
    accent: "#c13584",
    about: "Agents look after posts, stories and your audience.",
    prompts: [
      "How did my last five posts do compared to the five before?",
      "Draft three captions for a behind the scenes post",
      "Summarise this week's comments and flag any that need a reply",
    ],
  },
  facebook: {
    category: "Social",
    accent: "#1877f2",
    about: "Agents manage Pages and posts.",
    prompts: [
      "Summarise this week's activity on my page",
      "Draft a post announcing our new opening hours",
      "List comments from the last week that ask a question",
    ],
  },
  sentry: {
    category: "Developer tools",
    accent: "#362d59",
    about: "Agents watch errors as they happen and explain what broke.",
    prompts: [
      "What are the top new errors since yesterday's release?",
      "Explain the most frequent error this week and where it starts",
      "List unresolved issues affecting the most users",
    ],
  },
  posthog: {
    category: "Analytics",
    accent: "#e65c2e",
    about: "Agents read product analytics and feature flags.",
    prompts: [
      "How did signups change this week compared to last?",
      "Which feature flags are fully rolled out and could be removed?",
      "Summarise the funnel from signup to first project",
    ],
  },
  discord: {
    category: "Communication",
    accent: "#5865f2",
    about: "Agents follow channels and messages, and post for you.",
    prompts: [
      "Catch me up on the announcements channel",
      "Summarise this week's questions in the help channel",
      "Draft a welcome message for new members",
    ],
  },
  x: {
    category: "Social",
    accent: "#2a2a2a",
    about: "Agents read your timeline and post for you.",
    prompts: [
      "Summarise what people said about us this week",
      "Draft three posts announcing the release",
      "List replies to my last post that deserve an answer",
    ],
  },
  reddit: {
    category: "Social",
    accent: "#ff4500",
    about: "Agents follow subreddits and post to them.",
    prompts: [
      "Summarise this week's top posts in the subreddits I follow",
      "Find threads where people asked about tools like ours",
      "Draft a helpful reply to the most upvoted question",
    ],
  },
  zapier: {
    category: "Automation",
    accent: "#ff4a00",
    about: "Agents reach thousands of other apps through your Zapier connections.",
    prompts: [
      "What can you reach through my Zapier connections?",
      "Add a row to my sales sheet whenever I mark a deal won",
      "Send me a summary of new form responses each morning",
    ],
  },
  hubspot: {
    category: "Sales",
    accent: "#ff7a59",
    about: "Agents work with contacts and deals: updates, follow-ups and pipeline reviews.",
    prompts: [
      "Which deals have had no activity in two weeks?",
      "Summarise my pipeline by stage with this month's changes",
      "Draft follow-ups for contacts I met at last week's event",
    ],
  },
  salesforce: {
    category: "Sales",
    accent: "#00a1e0",
    about: "Agents read and update records and reports.",
    prompts: [
      "Summarise my open opportunities closing this quarter",
      "Which accounts have not been contacted in a month?",
      "Update the stage on the deals I closed this week",
    ],
  },
  jira: {
    category: "Developer tools",
    accent: "#0c66e4",
    about: "Agents track tickets and sprints.",
    prompts: [
      "What is blocked in the current sprint, and by what?",
      "Summarise tickets assigned to me by priority",
      "Write release notes from the tickets closed this sprint",
    ],
  },
  asana: {
    category: "Productivity",
    accent: "#f06a6a",
    about: "Agents manage tasks and projects.",
    prompts: [
      "What is due this week across my projects?",
      "List overdue tasks and who owns them",
      "Turn these meeting notes into tasks with owners",
    ],
  },
  trello: {
    category: "Productivity",
    accent: "#0c66e4",
    about: "Agents move cards and keep boards current.",
    prompts: [
      "Summarise my board: what moved this week and what is stuck",
      "Add cards for each item in this list",
      "Which cards have no due date?",
    ],
  },
  dropbox: {
    category: "Files",
    accent: "#0061fe",
    about: "Agents find and organise files and folders.",
    prompts: [
      "Find the latest signed agreement",
      "List large files I have not opened in a year",
      "What did my team add to the shared folder this week?",
    ],
  },
  airtable: {
    category: "Productivity",
    accent: "#2d7ff9",
    about: "Agents read and update bases and records.",
    prompts: [
      "Summarise records added to my base this week",
      "Find records with missing fields",
      "Add these items as new records",
    ],
  },
  figma: {
    category: "Design",
    accent: "#a259ff",
    about: "Agents read designs and comments, and bring feedback into your work.",
    prompts: [
      "Summarise the open comments on my latest file",
      "List frames changed this week",
      "Turn the design review comments into a checklist",
    ],
  },
  stripe: {
    category: "Finance",
    accent: "#635bff",
    about: "Agents look up customers and payments.",
    prompts: [
      "How much did we take in this week compared to last?",
      "List failed payments from the last seven days",
      "Find customers whose subscription renews this month",
    ],
  },
};

/** The details for an app, written or built from its own name and line. */
export function detailsFor(card: { slug: string; label: string; blurb: string }): AppDetails {
  return (
    D[card.slug] ?? {
      category: "App",
      accent: "#3b3f58",
      about: `${card.blurb.replace(/\.$/, "")}. Connect it once, and any agent with connected apps can use it.`,
      prompts: [
        `What can you do with ${card.label}?`,
        `Summarise what changed in ${card.label} this week`,
        `Show me the most recent items in ${card.label}`,
      ],
    }
  );
}
