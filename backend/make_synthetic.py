"""Write data/synthetic_job_invest.csv: example job and investment messages written by us.

These are NOT real messages. They follow the scam pattern described by the SEC and Philippine news
(unsolicited offer, big daily pay, a chat link, small task payments, "recharge" deposits, a fee to
withdraw) and ordinary legitimate messages (interview schedules, job-fair notices, bank and
investment notices). Companies, banks and brokers are made up.

They are used for training only. They are never in the validation or test split (see train_text.py).

Run:  python make_synthetic.py
"""
import csv
import os
import random

random.seed(42)

NAMES = ["Ana", "Mark", "Joy", "Carlo", "Grace", "Paolo", "Mica", "Jun", "Liza", "Ryan", "Bea", "Nico"]
HR = ["Ms. Reyes", "Mr. Santos", "Ms. Dela Cruz", "Ms. Garcia", "Mr. Ramos", "Ms. Lim", "Ms. Torres"]
SCAM_CO = ["BrightPath Digital", "NovaHire Online", "Sunrise Tasking Hub", "PrimeLink Marketing",
           "SkyBridge Global", "GoldenLeaf Online", "OptiWork PH", "MegaGrow Capital", "StarTrade Hub"]
REAL_CO = ["Harbor Point BPO", "Kapitolyo Retail Corp.", "Mabuhay Logistics", "Bayanihan Foods Inc.",
           "Luzon Tech Solutions", "Pioneer Customer Care", "Island Hotel Group", "Santiago Medical Center"]
ROLES = ["Customer Service Representative", "Sales Associate", "Accounting Staff", "Warehouse Staff",
         "Administrative Assistant", "IT Support", "Graphic Designer", "Nurse Aide"]
PLACES = ["our Makati office", "the Cebu branch", "the Quezon City office", "the Davao branch",
          "Ortigas head office", "the Pasig branch", "our Iloilo office"]
DATES = ["Nov 10", "Nov 12", "Nov 14", "Nov 17", "Nov 20", "Dec 2", "Dec 5", "November 25", "December 9"]
TIMES = ["9:00 AM", "10:30 AM", "1:30 PM", "2:00 PM", "3:30 PM"]
PAY = ["P800-P5,000 per day", "P1,500 daily", "P3,000 a day", "P500 to P10,000/day", "P2,000-P8,000 daily",
       "P1,000 per day", "up to P15,000 a day", "P200-P3,000 kada araw"]
FEES = ["300", "500", "800", "1,000", "1,500", "2,000", "250"]
DEPS = ["100", "200", "500", "1,000", "3,000", "5,000"]
RETS = ["300", "1,000", "2,500", "5,000", "10,000", "20,000"]
PCTS = ["5", "10", "15", "20", "30"]
LINKS = ["wa.me/639171234567", "t.me/earnmore_ph", "bit.ly/3xYzAb", "http://work-ph.top/reg", "wa.me/639285550123",
         "https://tinyurl.com/job2earn", "t.me/tradewin_ph", "http://invest-now.vip/join", "bit.ly/4kPqRs"]
GREET = ["Hi", "Hello", "Hello po", "Good day", "Dear applicant", "Hi po", "Kumusta"]
BANKS = ["Luzon Savings Bank", "Pilipinas Trust Bank", "Mabuhay Bank", "Bayan Rural Bank"]
BROKER = ["Pioneer Securities", "Dalisay Online Trading", "Kabalikat Brokers"]
FUNDS = ["Bayanihan Balanced Fund", "Pilipinas Equity Fund", "Dalisay Bond Fund"]
MONTHS = ["September", "October", "November", "August"]
LAND = ["(02) 8123 4567", "(032) 234 5678", "(02) 8765 4321"]


def pick(xs):
    return random.choice(xs)


def fill(t):
    return t.format(
        g=pick(GREET), name=pick(NAMES), hr=pick(HR), sco=pick(SCAM_CO), rco=pick(REAL_CO), role=pick(ROLES),
        place=pick(PLACES), date=pick(DATES), time=pick(TIMES), pay=pick(PAY), fee=pick(FEES), dep=pick(DEPS),
        ret=pick(RETS), pct=pick(PCTS), link=pick(LINKS), bank=pick(BANKS), broker=pick(BROKER), fund=pick(FUNDS),
        month=pick(MONTHS), land=pick(LAND), n=random.choice([3, 5, 7, 10]), days=random.choice([3, 5, 7]),
        mins=random.choice([10, 15, 30]), comm=random.choice(["20%", "30%", "50%"]),
        bonus=random.choice(["50", "88", "100", "188"]), amt=random.choice(["1,250", "3,400", "8,900", "15,000"]),
        price=random.choice(["4.52", "12.80", "23.10"]), navps=random.choice(["1.4231", "2.0187", "1.0975"]),
        shares=random.choice([100, 200, 500]))


SCAM_JOB = [
    "{g} I am {hr} from {sco} hiring team. You are selected for a part-time job, earn {pay}. Just like and rate products online. Add me here {link}",
    "{g}! {sco} is hiring. Work from home using only your phone, earn {pay}. No experience needed. Message now {link}",
    "Magandang araw! Naghahanap ang {sco} ng online assistant, kumita ng {pay}. Mag-message sa {link} para sa detalye.",
    "Complete {n} simple tasks daily and get {comm} commission. Register at {link}. Recharge P{dep} to start, withdraw anytime.",
    "Congratulations! Pumasa ka sa online interview ng {sco}. Magbayad ng P{fee} registration fee via GCash para ma-activate ang account mo.",
    "{g} po, need ng {n} online workers, easy task lang. Bayad {pay}, daily payout via GCash. Click {link} agad, limited slots lang.",
    "URGENT hiring! Domestic helper sa Dubai, salary 1,200 USD, free visa. Send P{fee} processing fee via GCash para ma-reserve ang slot mo. Contact {link}",
    "Your resume was viewed by {sco}. Position: Data Entry, rate {pay}. To confirm, send P{fee} for training materials.",
    "Bonus alert: finish today's order task and get P{bonus} free. Deposit P{dep} to unlock the next level and earn {comm}. Group {link}",
    "Dear, I am a human resources manager of {sco}. You have been selected for a part-time/full-time job. Now you can reach {pay}. Reply YES or add {link}",
    "Trabaho para sa lahat! Walang experience, walang interview. Kumita ng {pay} sa pag-like ng videos. Sumali na sa {link}",
    "{g}, we are recruiting for {sco}. Work 1-2 hours a day only, salary {pay}. Daily payment, no fee. Contact our manager {link}",
    "Task update: your account is frozen. Pay P{fee} verification fee to unfreeze and withdraw your commission of P{ret}. Chat {link}",
    "Hiring ngayon: online seller assistant. Sahod {pay}, may free na load pa. I-click ang {link} at ibigay ang GCash number mo para sa payout.",
]
SCAM_INV = [
    "Invest P{dep} today and get P{ret} in {mins} minutes! Guaranteed profit, no risk. Join {link}",
    "Crypto trading signals! Doblehin ang pera mo sa {days} araw, 100% legit, may payout proof. Message {link}",
    "{sco} Investment: earn {pct}% weekly, minimum P{dep}. Invite 3 friends and get P{bonus} referral bonus. Register {link}",
    "Congratulations, you were chosen for an exclusive investment opportunity. Triple your money in {days} days. Limited slots, send P{dep} via GCash to start.",
    "Tubo ng pera mo sa bangko, maliit lang. Mag-invest sa {sco}, kita ng P{ret} araw-araw. Walang risk. Sumali sa {link}",
    "To withdraw your profit of P{ret}, pay the P{fee} tax first. Send via GCash then screenshot here {link}",
    "Our AI trading bot earns {pct}% daily. Deposit P{dep}, withdraw anytime. Join Telegram {link}",
    "Forex mentor sa Pinas: turuan kita kumita ng P{ret} per week. Send P{fee} para sa course, guaranteed na may kita. {link}",
    "{g}, invest lang ng P{dep}, balik agad ng P{ret} sa loob ng {mins} minuto. Registered daw sa SEC. Chat na sa {link}",
    "Last chance! {sco} pays {pct}% interest every day. Deposit now, double your money in {days} days. {link}",
    "Mag-invest sa {sco}. Sure na kita, walang talo. Minimum P{dep} lang, may bonus pa na P{bonus} kapag nag-invite ka. {link}",
]
LEGIT_JOB = [
    "Hi {name}, this is {hr} from {rco} HR. Your interview for {role} is on {date} at {time}, {place}. Please bring a valid ID and your resume. No fees are required at any stage. Reply to confirm.",
    "Good day {name}. Thank you for applying to {rco}. We received your application for {role}. Our team will contact you within {n} working days.",
    "Magandang araw, {name}. Ito ang HR ng {rco}. Naka-schedule ang interview mo sa {date}, {time}, sa {place}. Dalhin lang po ang resume at valid ID. Libre po ang buong proseso.",
    "Hi {name}, congratulations! You passed the final interview at {rco}. Your job offer was sent to your email. Please review and reply by {date}. The company shoulders the medical exam.",
    "PESO job fair on {date}, {time} at {place}. Free entry, bring copies of your resume. Employers: {rco} and others. Walang bayad.",
    "Reminder: your online assessment for {role} at {rco} is tomorrow at {time}. The link will be sent to your registered email. For questions call HR at {land}.",
    "Hello {name}, pinadala na namin sa email mo ang job offer para sa {role}. Please sign and send back by {date}. Requirements: NBI, TIN, SSS. Thank you!",
    "{rco}: We regret to inform you that you were not selected for {role}. We will keep your resume on file. Thank you for your interest.",
    "Your training at {rco} starts on {date}, {time}, at {place}. Wear business casual. Salary is paid on the 15th and 30th through payroll. No payment is needed from you.",
    "Hi {name}, may follow-up lang po kami sa application mo for {role}. Available ka ba for a phone interview on {date}, {time}? Reply lang po. Thank you!",
    "{rco} HR: Your requirements for {role} are complete. Please report to {place} on {date} at {time} for contract signing. Bring a valid ID.",
    "Good day {name}. This is a reminder that your interview with {rco} is tomorrow, {time}, at {place}. Please arrive 15 minutes early. Call {land} if you can't make it.",
]
LEGIT_INV = [
    "{bank}: Your time deposit of P{amt} matures on {date}. Visit any branch or log in to the app to renew. Never share your OTP with anyone.",
    "{bank} reminder: your investment account statement for {month} is now available in the mobile app. Investing involves risk and returns are not guaranteed.",
    "Your order to buy {shares} shares of ABC was executed at P{price}. Settlement date {date}. - {broker}",
    "Your savings fund dividend of P{amt} was credited to your account on {date}. Thank you for your contribution.",
    "{fund}: NAVPS as of {date} is {navps}. Past performance is not a guarantee of future results. Registered with the SEC.",
    "SEC reminder: check if an investment company is registered at sec.gov.ph before you invest. Be careful of offers that promise guaranteed high returns.",
    "{bank}: Your treasury bond coupon payment of P{amt} was credited on {date}. Check your account in the mobile app.",
    "Nag-credit na ang interest ng savings mo na P{amt} ngayong {month}. Salamat sa pagtitiwala sa {bank}.",
    "BABALA: Hindi kami nag-aalok ng investment sa text. Huwag maniwala sa nangangakong doble ang pera. I-report sa hotline ng {bank} sa {land}.",
    "{bank}: Your monthly investment plan of P{amt} was deducted on {date}. For concerns call {land} or visit any branch.",
    "{broker}: Your account statement is ready. Log in at our official website to view. We will never ask for your password or OTP.",
]


def make(templates, n, label, topic, source):
    seen, rows, tries = set(), [], 0
    while len(rows) < n and tries < 5000:
        tries += 1
        text = fill(random.choice(templates))
        if text in seen:
            continue
        seen.add(text)
        rows.append((text, topic, label, source))
    return rows


def main():
    rows = []
    rows += make(SCAM_JOB, 60, "scam", "job", "synthetic")
    rows += make(SCAM_INV, 50, "scam", "investment", "synthetic")
    rows += make(LEGIT_JOB, 60, "legit", "job", "synthetic")
    rows += make(LEGIT_INV, 50, "legit", "investment", "synthetic")
    # the one real job-scam text quoted in the Inquirer article (Nov 2021), kept for reference
    rows.append(("Dear, I am a human resources manager. You have been selected for a part-time/full-time job. "
                 "Now you can reach P800-P10,000/day,", "job", "scam", "news"))
    os.makedirs("data", exist_ok=True)
    with open("data/synthetic_job_invest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["text", "topic_hint", "label", "source"])
        w.writerows(rows)
    print(f"wrote data/synthetic_job_invest.csv with {len(rows)} rows")


if __name__ == "__main__":
    main()
