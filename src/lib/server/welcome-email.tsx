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

export interface RenderWelcomeEmailInput {
  /** Recipient's name (first name is used for the greeting). Falls back to a neutral greeting. */
  name?: string;
  /** Calendly link for the "book a quick call" CTA. */
  calendlyUrl: string;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const LINK = "#1155cc";

function firstName(full?: string): string {
  const token = (full ?? "").trim().split(/\s+/)[0];
  return token || "there";
}

export async function renderWelcomeEmail(input: RenderWelcomeEmailInput): Promise<{
  html: string;
  text: string;
  subject: string;
}> {
  const subject = "A quick hello from Actioneer";
  const html = await render(<WelcomeEmail {...input} />, { pretty: false });
  const text = buildText(input);
  return { html, text, subject };
}

function WelcomeEmail(props: RenderWelcomeEmailInput) {
  const name = firstName(props.name);

  return (
    <Html>
      <Head>
        {/* Stop mobile mail clients from auto-linking the email / phone in their
            own color so they match the rest of the email. */}
        <meta name="format-detection" content="telephone=no,email=no,address=no,date=no" />
        {/* Tell mail clients the email adapts to dark mode itself, so they don't
            force a grey box behind it. */}
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Preview>A quick hello from Divyansh at Actioneer. Happy to help or hop on a call.</Preview>
      <Body style={{ margin: 0, padding: 0 }}>
        <Container style={{ width: "100%", maxWidth: "none", margin: "0", padding: "16px 4px" }}>
          <Text style={para}>Hi {name},</Text>

          <Text style={para}>
            Thanks for signing in to Actioneer. Glad to have you exploring the platform.
          </Text>

          <Text style={para}>
            I wanted to personally say hello. If you have any questions about what you&apos;re seeing,
            or want a closer look at how Actioneer fits your team, I&apos;m happy to help.
          </Text>

          <Text style={para}>
            You can simply reply to this email, or book a quick call with me here:{" "}
            <Link href={props.calendlyUrl} style={link}>book a time</Link>.
          </Text>

          <Text style={para}>Looking forward to it!</Text>

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

function buildText(props: RenderWelcomeEmailInput): string {
  const name = firstName(props.name);
  return [
    `Hi ${name},`,
    "",
    "Thanks for signing in to Actioneer. Glad to have you exploring the platform.",
    "",
    "I wanted to personally say hello. If you have any questions about what you're seeing, or want a closer look at how Actioneer fits your team, I'm happy to help.",
    "",
    `You can simply reply to this email, or book a quick call with me here: ${props.calendlyUrl}`,
    "",
    "Looking forward to it!",
    "",
    "Divyansh Aneriya",
    "Actioneer",
    "+91 89796 30873 | actioneer.com | https://www.linkedin.com/in/aneriya/",
  ].join("\n");
}
