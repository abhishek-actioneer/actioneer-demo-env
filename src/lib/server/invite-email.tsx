import { render } from "@react-email/render";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";

export interface RenderInviteEmailInput {
  championName: string;
  dealOwnerName: string;
  /** Kept for compatibility; the signature is Divyansh's fixed block. */
  senderName: string;
  loginEmail: string;
  password: string;
  magicLink: string;
  loomUrl?: string;
  expiryHours?: number;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const LINK = "#1155cc";

function firstName(full: string): string {
  const token = full.trim().split(/\s+/)[0];
  return token || full.trim();
}

export async function renderInviteEmail(input: RenderInviteEmailInput): Promise<{
  html: string;
  text: string;
  subject: string;
}> {
  const expiry = input.expiryHours ?? 48;
  const subject = "Actioneer Demo Workspace Creds";
  const html = await render(<InviteEmail {...input} expiryHours={expiry} />, { pretty: false });
  const text = buildText({ ...input, expiryHours: expiry });
  return { html, text, subject };
}

function InviteEmail(props: RenderInviteEmailInput) {
  const champion = firstName(props.championName);
  const owner = props.dealOwnerName.trim();
  const expiry = props.expiryHours ?? 48;

  return (
    <Html>
      <Head>
        {/* Stop mobile mail clients from auto-linking the login email / phone in
            their own color so they match the rest of the email. */}
        <meta name="format-detection" content="telephone=no,email=no,address=no,date=no" />
        {/* Tell mail clients the email adapts to dark mode itself, so they don't
            force a grey box behind it (the issue on Gmail/Apple Mail in dark mode). */}
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Preview>{`Your Actioneer demo workspace is ready. Magic link valid for ${expiry} hours.`}</Preview>
      <Body style={{ margin: 0, padding: 0 }}>
        <Container style={{ width: "100%", maxWidth: "none", margin: "0", padding: "16px 4px" }}>
          <Text style={para}>Hi {champion},</Text>

          <Text style={para}>
            {owner} mentioned you wanted to take Actioneer for a spin, so I&apos;ve set up a demo
            workspace for you. I&apos;m here for anything you need along the way.
          </Text>

          <Text style={para}>
            When you open it, a quick guided tour will walk you through the platform, and you can
            replay it anytime from Walkthrough in the sidebar.
          </Text>

          {props.loomUrl ? (
            <Text style={para}>
              And if you prefer watching over reading, here&apos;s a quick video walkthrough:{" "}
              <Link href={props.loomUrl} style={link}>watch it here</Link>.
            </Text>
          ) : null}

          <Text style={para}>
            You can jump straight in with this magic link, valid for the next {expiry} hours and fine
            to share with your team:{" "}
            <Link href={props.magicLink} style={link}>open your workspace</Link>.
          </Text>

          <Text style={{ ...para, marginBottom: 8 }}>
            Your login details, which you can use anytime:
          </Text>
          <Text style={{ ...para, margin: "0 0 4px" }}>
            Email: <span style={{ color: LINK }}>{props.loginEmail}</span>
          </Text>
          <Text style={{ ...para, margin: "0 0 16px" }}>Password: {props.password}</Text>

          <Hr style={{ borderColor: "#e5e5e5", margin: "24px 0 16px" }} />
          <Text style={{ ...para, margin: "0", fontWeight: 700 }}>Divyansh Aneriya</Text>
          <Text style={{ ...para, margin: "2px 0 0" }}>
            <Link href="https://actioneer.com" style={link}>Actioneer</Link>
          </Text>
          <Text style={{ ...para, margin: "2px 0 0", color: "#555555" }}>
            +91 89796 30873 &nbsp;|&nbsp;{" "}
            <Link href="https://actioneer.com" style={link}>actioneer.com</Link> &nbsp;|&nbsp;{" "}
            <Link href="https://www.linkedin.com/in/aneriya/" style={link}>LinkedIn</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const para = {
  color: "#202020",
  fontFamily: FONT,
  fontSize: 13.5,
  lineHeight: "1.6",
  margin: "0 0 16px",
} as const;

const link = { color: LINK, textDecoration: "underline" } as const;

function buildText(props: RenderInviteEmailInput): string {
  const champion = firstName(props.championName);
  const owner = props.dealOwnerName.trim();
  const expiry = props.expiryHours ?? 48;
  const lines = [
    `Hi ${champion},`,
    "",
    `${owner} mentioned you wanted to take Actioneer for a spin, so I've set up a demo workspace for you. I'm here for anything you need along the way.`,
    "",
    "When you open it, a quick guided tour will walk you through the platform, and you can replay it anytime from Walkthrough in the sidebar.",
    "",
  ];
  if (props.loomUrl) {
    lines.push(`And if you prefer watching over reading, here's a quick video walkthrough: ${props.loomUrl}`, "");
  }
  lines.push(
    `Jump straight in with this magic link, valid for the next ${expiry} hours and fine to share with your team:`,
    props.magicLink,
    "",
    "Your login details, which you can use anytime:",
    `Email: ${props.loginEmail}`,
    `Password: ${props.password}`,
    "",
    "Divyansh Aneriya",
    "Actioneer",
    "+91 89796 30873 | actioneer.com | https://www.linkedin.com/in/aneriya/",
  );
  return lines.join("\n");
}
