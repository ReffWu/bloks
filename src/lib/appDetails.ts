// What an app's details page says about it: a line or two on what agents
// can do with it, the kind of app it is, three things to try, and the
// colour its header is washed in. Written for the apps Bloks ships with;
// any other app from the full catalogue gets the same page built from its
// own name and line.
//
// The table keeps catalogue keys rather than words, and detailsFor reads
// them when it is asked, so the page follows the reader's language. The
// prompts are what a person sends an agent, so they are in that language
// too.
import { t, type MessageKey } from "./i18n.ts";

export interface AppDetails {
  about: string;
  category: string;
  /** Things to ask an agent, each ready to send once the app is connected. */
  prompts: string[];
  /** The app's own colour, for the header behind the prompts. */
  accent: string;
}

interface Written {
  about: MessageKey;
  category: MessageKey;
  prompts: readonly [MessageKey, MessageKey, MessageKey];
  accent: string;
}

const D: Record<string, Written> = {
  slack: {
    category: "libAppDetails.category.communication",
    accent: "#4a154b",
    about: "libAppDetails.slack.about",
    prompts: ["libAppDetails.slack.prompt1", "libAppDetails.slack.prompt2", "libAppDetails.slack.prompt3"],
  },
  github: {
    category: "libAppDetails.category.developerTools",
    accent: "#24292f",
    about: "libAppDetails.github.about",
    prompts: ["libAppDetails.github.prompt1", "libAppDetails.github.prompt2", "libAppDetails.github.prompt3"],
  },
  gmail: {
    category: "libAppDetails.category.communication",
    accent: "#3b3fa8",
    about: "libAppDetails.gmail.about",
    prompts: ["libAppDetails.gmail.prompt1", "libAppDetails.gmail.prompt2", "libAppDetails.gmail.prompt3"],
  },
  googlecalendar: {
    category: "libAppDetails.category.productivity",
    accent: "#1a62d6",
    about: "libAppDetails.googlecalendar.about",
    prompts: ["libAppDetails.googlecalendar.prompt1", "libAppDetails.googlecalendar.prompt2", "libAppDetails.googlecalendar.prompt3"],
  },
  googlesheets: {
    category: "libAppDetails.category.productivity",
    accent: "#0f8a4c",
    about: "libAppDetails.googlesheets.about",
    prompts: ["libAppDetails.googlesheets.prompt1", "libAppDetails.googlesheets.prompt2", "libAppDetails.googlesheets.prompt3"],
  },
  googledocs: {
    category: "libAppDetails.category.productivity",
    accent: "#2f6fe0",
    about: "libAppDetails.googledocs.about",
    prompts: ["libAppDetails.googledocs.prompt1", "libAppDetails.googledocs.prompt2", "libAppDetails.googledocs.prompt3"],
  },
  googledrive: {
    category: "libAppDetails.category.files",
    accent: "#1c8a5a",
    about: "libAppDetails.googledrive.about",
    prompts: ["libAppDetails.googledrive.prompt1", "libAppDetails.googledrive.prompt2", "libAppDetails.googledrive.prompt3"],
  },
  outlook: {
    category: "libAppDetails.category.communication",
    accent: "#0f5fb8",
    about: "libAppDetails.outlook.about",
    prompts: ["libAppDetails.outlook.prompt1", "libAppDetails.outlook.prompt2", "libAppDetails.outlook.prompt3"],
  },
  microsoft_teams: {
    category: "libAppDetails.category.communication",
    accent: "#4b53bc",
    about: "libAppDetails.microsoftTeams.about",
    prompts: ["libAppDetails.microsoftTeams.prompt1", "libAppDetails.microsoftTeams.prompt2", "libAppDetails.microsoftTeams.prompt3"],
  },
  excel: {
    category: "libAppDetails.category.productivity",
    accent: "#107c41",
    about: "libAppDetails.excel.about",
    prompts: ["libAppDetails.excel.prompt1", "libAppDetails.excel.prompt2", "libAppDetails.excel.prompt3"],
  },
  one_drive: {
    category: "libAppDetails.category.files",
    accent: "#0a64c2",
    about: "libAppDetails.oneDrive.about",
    prompts: ["libAppDetails.oneDrive.prompt1", "libAppDetails.oneDrive.prompt2", "libAppDetails.oneDrive.prompt3"],
  },
  notion: {
    category: "libAppDetails.category.productivity",
    accent: "#2f2f2f",
    about: "libAppDetails.notion.about",
    prompts: ["libAppDetails.notion.prompt1", "libAppDetails.notion.prompt2", "libAppDetails.notion.prompt3"],
  },
  linear: {
    category: "libAppDetails.category.developerTools",
    accent: "#5e6ad2",
    about: "libAppDetails.linear.about",
    prompts: ["libAppDetails.linear.prompt1", "libAppDetails.linear.prompt2", "libAppDetails.linear.prompt3"],
  },
  whatsapp: {
    category: "libAppDetails.category.communication",
    accent: "#128c4a",
    about: "libAppDetails.whatsapp.about",
    prompts: ["libAppDetails.whatsapp.prompt1", "libAppDetails.whatsapp.prompt2", "libAppDetails.whatsapp.prompt3"],
  },
  instagram: {
    category: "libAppDetails.category.social",
    accent: "#c13584",
    about: "libAppDetails.instagram.about",
    prompts: ["libAppDetails.instagram.prompt1", "libAppDetails.instagram.prompt2", "libAppDetails.instagram.prompt3"],
  },
  facebook: {
    category: "libAppDetails.category.social",
    accent: "#1877f2",
    about: "libAppDetails.facebook.about",
    prompts: ["libAppDetails.facebook.prompt1", "libAppDetails.facebook.prompt2", "libAppDetails.facebook.prompt3"],
  },
  sentry: {
    category: "libAppDetails.category.developerTools",
    accent: "#362d59",
    about: "libAppDetails.sentry.about",
    prompts: ["libAppDetails.sentry.prompt1", "libAppDetails.sentry.prompt2", "libAppDetails.sentry.prompt3"],
  },
  posthog: {
    category: "libAppDetails.category.analytics",
    accent: "#e65c2e",
    about: "libAppDetails.posthog.about",
    prompts: ["libAppDetails.posthog.prompt1", "libAppDetails.posthog.prompt2", "libAppDetails.posthog.prompt3"],
  },
  discord: {
    category: "libAppDetails.category.communication",
    accent: "#5865f2",
    about: "libAppDetails.discord.about",
    prompts: ["libAppDetails.discord.prompt1", "libAppDetails.discord.prompt2", "libAppDetails.discord.prompt3"],
  },
  x: {
    category: "libAppDetails.category.social",
    accent: "#2a2a2a",
    about: "libAppDetails.x.about",
    prompts: ["libAppDetails.x.prompt1", "libAppDetails.x.prompt2", "libAppDetails.x.prompt3"],
  },
  reddit: {
    category: "libAppDetails.category.social",
    accent: "#ff4500",
    about: "libAppDetails.reddit.about",
    prompts: ["libAppDetails.reddit.prompt1", "libAppDetails.reddit.prompt2", "libAppDetails.reddit.prompt3"],
  },
  zapier: {
    category: "libAppDetails.category.automation",
    accent: "#ff4a00",
    about: "libAppDetails.zapier.about",
    prompts: ["libAppDetails.zapier.prompt1", "libAppDetails.zapier.prompt2", "libAppDetails.zapier.prompt3"],
  },
  hubspot: {
    category: "libAppDetails.category.sales",
    accent: "#ff7a59",
    about: "libAppDetails.hubspot.about",
    prompts: ["libAppDetails.hubspot.prompt1", "libAppDetails.hubspot.prompt2", "libAppDetails.hubspot.prompt3"],
  },
  salesforce: {
    category: "libAppDetails.category.sales",
    accent: "#00a1e0",
    about: "libAppDetails.salesforce.about",
    prompts: ["libAppDetails.salesforce.prompt1", "libAppDetails.salesforce.prompt2", "libAppDetails.salesforce.prompt3"],
  },
  jira: {
    category: "libAppDetails.category.developerTools",
    accent: "#0c66e4",
    about: "libAppDetails.jira.about",
    prompts: ["libAppDetails.jira.prompt1", "libAppDetails.jira.prompt2", "libAppDetails.jira.prompt3"],
  },
  asana: {
    category: "libAppDetails.category.productivity",
    accent: "#f06a6a",
    about: "libAppDetails.asana.about",
    prompts: ["libAppDetails.asana.prompt1", "libAppDetails.asana.prompt2", "libAppDetails.asana.prompt3"],
  },
  trello: {
    category: "libAppDetails.category.productivity",
    accent: "#0c66e4",
    about: "libAppDetails.trello.about",
    prompts: ["libAppDetails.trello.prompt1", "libAppDetails.trello.prompt2", "libAppDetails.trello.prompt3"],
  },
  dropbox: {
    category: "libAppDetails.category.files",
    accent: "#0061fe",
    about: "libAppDetails.dropbox.about",
    prompts: ["libAppDetails.dropbox.prompt1", "libAppDetails.dropbox.prompt2", "libAppDetails.dropbox.prompt3"],
  },
  airtable: {
    category: "libAppDetails.category.productivity",
    accent: "#2d7ff9",
    about: "libAppDetails.airtable.about",
    prompts: ["libAppDetails.airtable.prompt1", "libAppDetails.airtable.prompt2", "libAppDetails.airtable.prompt3"],
  },
  figma: {
    category: "libAppDetails.category.design",
    accent: "#a259ff",
    about: "libAppDetails.figma.about",
    prompts: ["libAppDetails.figma.prompt1", "libAppDetails.figma.prompt2", "libAppDetails.figma.prompt3"],
  },
  stripe: {
    category: "libAppDetails.category.finance",
    accent: "#635bff",
    about: "libAppDetails.stripe.about",
    prompts: ["libAppDetails.stripe.prompt1", "libAppDetails.stripe.prompt2", "libAppDetails.stripe.prompt3"],
  },
  googleslides: {
    category: "libAppDetails.category.productivity",
    accent: "#e8a10b",
    about: "libAppDetails.googleslides.about",
    prompts: ["libAppDetails.googleslides.prompt1", "libAppDetails.googleslides.prompt2", "libAppDetails.googleslides.prompt3"],
  },
  googlemeet: {
    category: "libAppDetails.category.communication",
    accent: "#00897b",
    about: "libAppDetails.googlemeet.about",
    prompts: ["libAppDetails.googlemeet.prompt1", "libAppDetails.googlemeet.prompt2", "libAppDetails.googlemeet.prompt3"],
  },
  zoom: {
    category: "libAppDetails.category.communication",
    accent: "#0b5cff",
    about: "libAppDetails.zoom.about",
    prompts: ["libAppDetails.zoom.prompt1", "libAppDetails.zoom.prompt2", "libAppDetails.zoom.prompt3"],
  },
  linkedin: {
    category: "libAppDetails.category.social",
    accent: "#0a66c2",
    about: "libAppDetails.linkedin.about",
    prompts: ["libAppDetails.linkedin.prompt1", "libAppDetails.linkedin.prompt2", "libAppDetails.linkedin.prompt3"],
  },
  youtube: {
    category: "libAppDetails.category.social",
    accent: "#e00000",
    about: "libAppDetails.youtube.about",
    prompts: ["libAppDetails.youtube.prompt1", "libAppDetails.youtube.prompt2", "libAppDetails.youtube.prompt3"],
  },
  clickup: {
    category: "libAppDetails.category.productivity",
    accent: "#7b68ee",
    about: "libAppDetails.clickup.about",
    prompts: ["libAppDetails.clickup.prompt1", "libAppDetails.clickup.prompt2", "libAppDetails.clickup.prompt3"],
  },
  monday: {
    category: "libAppDetails.category.productivity",
    accent: "#6161ff",
    about: "libAppDetails.monday.about",
    prompts: ["libAppDetails.monday.prompt1", "libAppDetails.monday.prompt2", "libAppDetails.monday.prompt3"],
  },
  todoist: {
    category: "libAppDetails.category.productivity",
    accent: "#e44332",
    about: "libAppDetails.todoist.about",
    prompts: ["libAppDetails.todoist.prompt1", "libAppDetails.todoist.prompt2", "libAppDetails.todoist.prompt3"],
  },
  confluence: {
    category: "libAppDetails.category.productivity",
    accent: "#1868db",
    about: "libAppDetails.confluence.about",
    prompts: ["libAppDetails.confluence.prompt1", "libAppDetails.confluence.prompt2", "libAppDetails.confluence.prompt3"],
  },
  gitlab: {
    category: "libAppDetails.category.developerTools",
    accent: "#e24329",
    about: "libAppDetails.gitlab.about",
    prompts: ["libAppDetails.gitlab.prompt1", "libAppDetails.gitlab.prompt2", "libAppDetails.gitlab.prompt3"],
  },
  supabase: {
    category: "libAppDetails.category.developerTools",
    accent: "#249361",
    about: "libAppDetails.supabase.about",
    prompts: ["libAppDetails.supabase.prompt1", "libAppDetails.supabase.prompt2", "libAppDetails.supabase.prompt3"],
  },
  vercel: {
    category: "libAppDetails.category.developerTools",
    accent: "#2a2a2a",
    about: "libAppDetails.vercel.about",
    prompts: ["libAppDetails.vercel.prompt1", "libAppDetails.vercel.prompt2", "libAppDetails.vercel.prompt3"],
  },
  calendly: {
    category: "libAppDetails.category.productivity",
    accent: "#006bff",
    about: "libAppDetails.calendly.about",
    prompts: ["libAppDetails.calendly.prompt1", "libAppDetails.calendly.prompt2", "libAppDetails.calendly.prompt3"],
  },
  miro: {
    category: "libAppDetails.category.design",
    accent: "#e6b800",
    about: "libAppDetails.miro.about",
    prompts: ["libAppDetails.miro.prompt1", "libAppDetails.miro.prompt2", "libAppDetails.miro.prompt3"],
  },
  canva: {
    category: "libAppDetails.category.design",
    accent: "#00a3c4",
    about: "libAppDetails.canva.about",
    prompts: ["libAppDetails.canva.prompt1", "libAppDetails.canva.prompt2", "libAppDetails.canva.prompt3"],
  },
  webflow: {
    category: "libAppDetails.category.design",
    accent: "#146ef5",
    about: "libAppDetails.webflow.about",
    prompts: ["libAppDetails.webflow.prompt1", "libAppDetails.webflow.prompt2", "libAppDetails.webflow.prompt3"],
  },
  zendesk: {
    category: "libAppDetails.category.support",
    accent: "#03363d",
    about: "libAppDetails.zendesk.about",
    prompts: ["libAppDetails.zendesk.prompt1", "libAppDetails.zendesk.prompt2", "libAppDetails.zendesk.prompt3"],
  },
  intercom: {
    category: "libAppDetails.category.support",
    accent: "#1f8ded",
    about: "libAppDetails.intercom.about",
    prompts: ["libAppDetails.intercom.prompt1", "libAppDetails.intercom.prompt2", "libAppDetails.intercom.prompt3"],
  },
  freshdesk: {
    category: "libAppDetails.category.support",
    accent: "#25c16f",
    about: "libAppDetails.freshdesk.about",
    prompts: ["libAppDetails.freshdesk.prompt1", "libAppDetails.freshdesk.prompt2", "libAppDetails.freshdesk.prompt3"],
  },
  pipedrive: {
    category: "libAppDetails.category.sales",
    accent: "#017737",
    about: "libAppDetails.pipedrive.about",
    prompts: ["libAppDetails.pipedrive.prompt1", "libAppDetails.pipedrive.prompt2", "libAppDetails.pipedrive.prompt3"],
  },
  mailchimp: {
    category: "libAppDetails.category.marketing",
    accent: "#241c15",
    about: "libAppDetails.mailchimp.about",
    prompts: ["libAppDetails.mailchimp.prompt1", "libAppDetails.mailchimp.prompt2", "libAppDetails.mailchimp.prompt3"],
  },
  typeform: {
    category: "libAppDetails.category.productivity",
    accent: "#262627",
    about: "libAppDetails.typeform.about",
    prompts: ["libAppDetails.typeform.prompt1", "libAppDetails.typeform.prompt2", "libAppDetails.typeform.prompt3"],
  },
  shopify: {
    category: "libAppDetails.category.commerce",
    accent: "#5e8e3e",
    about: "libAppDetails.shopify.about",
    prompts: ["libAppDetails.shopify.prompt1", "libAppDetails.shopify.prompt2", "libAppDetails.shopify.prompt3"],
  },
  quickbooks: {
    category: "libAppDetails.category.finance",
    accent: "#2ca01c",
    about: "libAppDetails.quickbooks.about",
    prompts: ["libAppDetails.quickbooks.prompt1", "libAppDetails.quickbooks.prompt2", "libAppDetails.quickbooks.prompt3"],
  },
  xero: {
    category: "libAppDetails.category.finance",
    accent: "#1ab4d7",
    about: "libAppDetails.xero.about",
    prompts: ["libAppDetails.xero.prompt1", "libAppDetails.xero.prompt2", "libAppDetails.xero.prompt3"],
  },
  docusign: {
    category: "libAppDetails.category.productivity",
    accent: "#4c00ff",
    about: "libAppDetails.docusign.about",
    prompts: ["libAppDetails.docusign.prompt1", "libAppDetails.docusign.prompt2", "libAppDetails.docusign.prompt3"],
  },
  box: {
    category: "libAppDetails.category.files",
    accent: "#0061d5",
    about: "libAppDetails.box.about",
    prompts: ["libAppDetails.box.prompt1", "libAppDetails.box.prompt2", "libAppDetails.box.prompt3"],
  },
};

/** The details for an app, written or built from its own name and line. */
export function detailsFor(card: { slug: string; label: string; blurb: string }): AppDetails {
  const written = D[card.slug];
  if (written) {
    return {
      category: t(written.category),
      accent: written.accent,
      about: t(written.about),
      prompts: written.prompts.map((key) => t(key)),
    };
  }
  // The catalogue's own line, as the catalogue words it.
  return {
    category: t("libAppDetails.category.app"),
    accent: "#3b3f58",
    about: `${card.blurb.replace(/\.$/, "")}.`,
    prompts: [
      t("libAppDetails.fallback.whatCanYouDo", { app: card.label }),
      t("libAppDetails.fallback.whatChanged", { app: card.label }),
      t("libAppDetails.fallback.mostRecent", { app: card.label }),
    ],
  };
}
