#!/usr/bin/env python3
"""
send_emails.py

Reads contacts.csv (columns: first_name,last_name,company,email,...), fills a
template per contact, and sends each email one at a time via SMTP with a
delay between sends so it looks hand-sent.

Setup:
    1. Fill in SMTP_PASSWORD with a Gmail App Password (Google Account >
       Security > 2-Step Verification > App passwords). NOT your login password.
    2. Run:  python3 send_emails.py
       Add --dry-run to print without sending.
"""

import csv
import smtplib
import ssl
import sys
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# ----------------------------- CONFIG -----------------------------

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "railioxyz@gmail.com"
SMTP_PASSWORD = "zzsvsbdqjcekzkmz"  # regenerate this; do not reuse the leaked one

FROM_NAME = "Imran"
FROM_ADDRESS = "railioxyz@gmail.com"

CSV_PATH = "contacts.csv"

# Seconds to wait between each send.
DELAY_SECONDS = 15

CALENDLY_URL = "https://calendly.com/imranhusain5000/30min"

# Subject line. {name} and {company} are filled per contact.
SUBJECT_TEMPLATE = "Quick note for {company}"

# Body. {name}, {company}, and {calendly} are filled per contact.
BODY_TEMPLATE = """Hi {name},

I'm Imran, the founder of Railio. It's an AI co-pilot for locomotive and car repair that gives every technician the knowledge of your most experienced people, right when they need it.

When a tough problem shows up, junior techs can lose hours chasing what a senior tech would spot in minutes. Railio puts that knowledge in reach for the whole team, so a junior tech can troubleshoot as confidently as a veteran.

Here's my {calendly} if you wanted to book a time to learn more! In the meantime, feel free to check out our website railio.xyz

Best,
Imran

Railio Inc.
railioxyz@gmail.com | 773-892-9280
Website: railio.xyz
"""

# ------------------------- END CONFIG -----------------------------


def build_message(row):
    """Build a MIME email for one CSV row."""
    name = row.get("first_name", "").strip() or "there"
    company = row.get("company", "").strip() or "your team"
    to_addr = row["email"].strip()

    subject = SUBJECT_TEMPLATE.format(name=name, company=company)

    # Plain-text: show the full URL so it's clickable in text clients.
    text_body = BODY_TEMPLATE.format(
        name=name, company=company, calendly=CALENDLY_URL
    )

    # HTML: the word "calendly" becomes the hyperlink.
    calendly_link = f'<a href="{CALENDLY_URL}">calendly</a>'
    html_source = BODY_TEMPLATE.format(
        name=name, company=company, calendly=calendly_link
    )
    html_body = html_source.replace("\n", "<br>")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{FROM_NAME} <{FROM_ADDRESS}>"
    msg["To"] = to_addr

    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(f"<html><body>{html_body}</body></html>", "html"))

    return to_addr, subject, msg


def load_contacts(path):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        required = {"email", "first_name", "company"}
        missing = required - set(h.strip() for h in reader.fieldnames or [])
        if missing:
            sys.exit(f"CSV is missing columns: {', '.join(sorted(missing))}")
        rows = [r for r in reader if r.get("email", "").strip()]
    if not rows:
        sys.exit("No contacts with an email address found in the CSV.")
    return rows


def main():
    dry_run = "--dry-run" in sys.argv
    rows = load_contacts(CSV_PATH)
    print(f"Loaded {len(rows)} contacts from {CSV_PATH}.")
    if dry_run:
        print("DRY RUN - nothing will be sent.\n")

    context = ssl.create_default_context()
    server = None
    if not dry_run:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls(context=context)
        server.login(SMTP_USER, SMTP_PASSWORD)

    try:
        for i, row in enumerate(rows, 1):
            to_addr, subject, msg = build_message(row)
            if dry_run:
                print(f"[{i}/{len(rows)}] would send to {to_addr} | {subject}")
                continue

            server.sendmail(FROM_ADDRESS, [to_addr], msg.as_string())
            print(f"[{i}/{len(rows)}] sent to {to_addr}")

            if i < len(rows):
                time.sleep(DELAY_SECONDS)
    finally:
        if server:
            server.quit()

    print("\nDone.")


if __name__ == "__main__":
    main()