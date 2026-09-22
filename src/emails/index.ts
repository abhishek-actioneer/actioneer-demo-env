import type { ComponentType } from "react";
import { MarketingEmail, type MarketingEmailProps } from "./marketing-email";
import { AnnouncementEmail } from "./announcement-email";
import { NewsletterEmail } from "./newsletter-email";

export type EmailTemplateId = "marketing" | "announcement" | "newsletter";

export interface EmailTemplateMeta {
  id: EmailTemplateId;
  label: string;
  description: string;
  Component: ComponentType<MarketingEmailProps>;
}

export const EMAIL_TEMPLATES: EmailTemplateMeta[] = [
  {
    id: "marketing",
    label: "Marketing",
    description: "Hero · features · image card · closing CTA · dark footer. For full marketing campaigns.",
    Component: MarketingEmail,
  },
  {
    id: "announcement",
    label: "Announcement",
    description: "Single-column. Big headline, body, one CTA. For product updates and crisp comms.",
    Component: AnnouncementEmail,
  },
  {
    id: "newsletter",
    label: "Newsletter",
    description: "Editorial masthead, lead story, additional articles. For long-form weekly sends.",
    Component: NewsletterEmail,
  },
];

export function getTemplate(id: string | null | undefined): EmailTemplateMeta {
  return EMAIL_TEMPLATES.find((t) => t.id === id) ?? EMAIL_TEMPLATES[0];
}

export type { MarketingEmailProps };
export { DEMO_PROPS } from "./marketing-email";
