"""Builds and signs the two iOS shortcuts for Spend Tracker v1.

  Spend Tracker.shortcut       - first run asks for the Web app URL and connects; after that it logs SMS
                                 (automation / share sheet) or asks for a cash amount (run by hand).
                                 If the saved code stops working, a manual run reconnects.
  Spend Tracker Auto.shortcut  - message automation (ebit / pent / ent Rs) that runs it on bank SMS.
                                 Works on iOS 26 only when the triggers have no Sender field.

Run on a Mac: python3 make_shortcuts.py   (needs the `shortcuts` command, macOS 12+)
"""
import os
import plistlib
import subprocess
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'shortcuts')
CODE_FILE = 'spend-tracker-code.txt'  # in iCloud Drive > Shortcuts
# Opened once after connecting; its page views count finished setups (no data about the user is sent).
DONE_PAGE = 'https://ismailwangde.github.io/spend-tracker/connected.html'
# Keep in sync with OTP in Code.gs. OTP texts never leave the phone.
OTP = (r'(?is)\b(?:otp|one[- ]?time password|verification code)\b\s*(?:is|:|-)?\s*\d{4,8}\b'
       r'|\b\d{4,8}\s+is\s+(?:your|the)\s+(?:otp|one[- ]?time password|verification code)\b'
       r'|\botp\b.{0,100}?\bis\s*:?\s*\d{4,8}(?![\d,]|\.\d)')
# Substrings, so each covers upper and lower case starts: "ebit" = Debited/debited/debit.
KEYWORDS = ['ebit', 'pent', 'ent Rs']

HAS_VALUE, NO_VALUE, CONTAINS = 100, 101, 99
# Input types of a message automation made on iOS 26 (from a real shared automation). With only
# WFStringContentItem, iOS dropped the message trigger on import.
ALL_INPUT = ['WFAppContentItem', 'WFAppStoreAppContentItem', 'WFArticleContentItem', 'WFContactContentItem',
             'WFDateContentItem', 'WFEmailAddressContentItem', 'WFFolderContentItem', 'WFGenericFileContentItem',
             'WFImageContentItem', 'WFiTunesProductContentItem', 'WFLocationContentItem', 'WFDCMapsLinkContentItem',
             'WFAVAssetContentItem', 'WFPDFContentItem', 'WFPhoneNumberContentItem', 'WFRichTextContentItem',
             'WFSafariWebPageContentItem', 'WFStringContentItem', 'WFURLContentItem']


def new_id():
    return str(uuid.uuid4()).upper()


def out(uid, name):
    return {'Type': 'ActionOutput', 'OutputUUID': uid, 'OutputName': name}


INPUT = {'Type': 'ExtensionInput'}


def att(v):
    return {'Value': v, 'WFSerializationType': 'WFTextTokenAttachment'}


def tok(*parts):
    """Text with variables in it. Positions are UTF-16 offsets."""
    s, atts = '', {}
    for p in parts:
        if isinstance(p, str):
            s += p
        else:
            atts['{%d, 1}' % (len(s.encode('utf-16-le')) // 2)] = p
            s += '￼'
    v = {'string': s}
    if atts:
        v['attachmentsByRange'] = atts
    return {'Value': v, 'WFSerializationType': 'WFTextTokenString'}


def act(ident, **params):
    return {'WFWorkflowActionIdentifier': 'is.workflow.actions.' + ident, 'WFWorkflowActionParameters': params}


def text(uid, value):
    return act('gettext', UUID=uid, WFTextActionText=value)


def if_(group, src, cond, string=None):
    p = dict(GroupingIdentifier=group, WFControlFlowMode=0, WFCondition=cond,
             WFInput={'Type': 'Variable', 'Variable': att(src)})
    if string is not None:
        p['WFConditionalActionString'] = string
    return act('conditional', **p)


def else_(group):
    return act('conditional', GroupingIdentifier=group, WFControlFlowMode=1)


def end(group):
    return act('conditional', GroupingIdentifier=group, WFControlFlowMode=2, UUID=new_id())


def fetch(uid, url, method='GET', body=None):
    p = dict(UUID=uid, WFURL=url, WFHTTPMethod=method, ShowHeaders=False)
    if body:
        p['WFHTTPBodyType'] = 'JSON'
        p['WFJSONValues'] = {'Value': {'WFDictionaryFieldValueItems': [
            {'WFItemType': 0, 'WFKey': tok(k), 'WFValue': v} for k, v in body]},
            'WFSerializationType': 'WFDictionaryFieldValue'}
    return act('downloadurl', **p)


def value(uid, key, src):
    return act('getvalueforkey', UUID=uid, WFDictionaryKey=key, WFGetDictionaryValueType='Value', WFInput=att(src))


def alert(title, message):
    return act('alert', WFAlertActionTitle=title, WFAlertActionMessage=message, WFAlertActionCancelButtonShown=False)


def notify(body):
    return act('notification', WFNotificationActionTitle='Spend Tracker', WFNotificationActionBody=body,
               WFNotificationActionSound=False)


def ask(uid, prompt, kind='Text', default=None):
    p = dict(UUID=uid, WFAskActionPrompt=prompt, WFInputType=kind)
    if default is not None:
        p['WFAskActionDefaultAnswer'] = default
    return act('ask', **p)


def open_done_page():
    u = new_id()
    return [act('url', UUID=u, WFURLActionURL=DONE_PAGE), act('openurl', WFInput=att(out(u, 'URL')))]


def save(src):
    return act('documentpicker.save', UUID=new_id(), WFInput=att(src), WFAskWhereToSave=False,
               WFFileDestinationPath=CODE_FILE, WFSaveFileOverwrite=True)


def as_text(uid, src):
    return act('detect.text', UUID=uid, WFInput=att(src))


def connect(prompt):
    """Ask for the Web app URL, claim a connection code and save it, then stop.
    Falls back to pasting the code from the Setup tab (e.g. when the Sheet is already connected).
    Replies are checked as text before any dictionary lookup: a reply that is a web page (iOS asking
    its one-time "allow connecting?" question mid-request) would otherwise stop the shortcut with an error."""
    q, warm, claim_url, claim, reply, code, code_text, pasted = (new_id() for _ in range(8))
    g_ok, g_paste = new_id(), new_id()
    done = [alert('Connected ✅', tok('Your Sheet is connected.')), *open_done_page()]
    return [
        ask(q, prompt),
        # Harmless first contact, so iOS asks its permission questions here and not during the claim.
        fetch(warm, tok(out(q, 'Provided Input'))),
        text(claim_url, tok(out(q, 'Provided Input'), '?claim=1')),
        fetch(claim, tok(out(claim_url, 'Text'))),
        as_text(reply, out(claim, 'Contents of URL')),
        if_(g_ok, out(reply, 'Text'), CONTAINS, '"code":"https'),
        value(code, 'code', out(reply, 'Text')),
        as_text(code_text, out(code, 'Dictionary Value')),
        save(out(code_text, 'Text')),
        *done,
        else_(g_ok),
        ask(pasted, tok("Couldn't connect automatically.\n\nIf the Setup tab of your Sheet shows a connection code, "
                        'paste it here. Otherwise check the Web app URL and try again.')),
        if_(g_paste, out(pasted, 'Provided Input'), CONTAINS, 'k='),
        save(out(pasted, 'Provided Input')),
        *done,
        end(g_paste),
        end(g_ok),
        act('exit'),
    ]


def main_shortcut():
    f, conn, match, sent, sent_t, note, check, check_t, amount, what, cash, cash_t, msg = (new_id() for _ in range(13))
    g_new, g_sms, g_otp, g_note, g_lost, g_stale, g_added = (new_id() for _ in range(7))
    actions = [
        act('documentpicker.open', UUID=f, WFGetFilePath=CODE_FILE, WFFileErrorIfNotFound=False,
            WFShowFilePicker=False),
        # First run: connect and keep the code in a file.
        if_(g_new, out(f, 'File'), NO_VALUE),
        *connect('Paste your Web app URL\n(Apps Script → Deploy → Manage deployments → Web app URL)'),
        end(g_new),
        as_text(conn, out(f, 'File')),
        # From an automation or the share sheet: send the SMS, unless it is an OTP.
        if_(g_sms, INPUT, HAS_VALUE),
        act('text.match', UUID=match, WFMatchTextPattern=OTP, WFMatchTextCaseSensitive=False, text=tok(INPUT)),
        if_(g_otp, out(match, 'Matches'), HAS_VALUE),
        act('exit'),
        end(g_otp),
        fetch(sent, tok(out(conn, 'Text')), 'POST', [('text', tok(INPUT))]),
        as_text(sent_t, out(sent, 'Contents of URL')),
        if_(g_note, out(sent_t, 'Text'), CONTAINS, '"notify"'),
        value(note, 'notify', out(sent_t, 'Text')),
        notify(tok(out(note, 'Dictionary Value'))),
        end(g_note),
        # The saved code stopped working (new copy of the Sheet, or "New phone?" was used).
        if_(g_lost, out(sent_t, 'Text'), CONTAINS, 'bad code'),
        notify(tok("Spend Tracker isn't connected to your Sheet any more. Open Shortcuts and tap Spend Tracker to fix it.")),
        end(g_lost),
        # Run by hand: check the connection, then a cash expense.
        else_(g_sms),
        fetch(check, tok(out(conn, 'Text'))),
        as_text(check_t, out(check, 'Contents of URL')),
        if_(g_stale, out(check_t, 'Text'), CONTAINS, 'bad code'),
        *connect('This phone is no longer connected to your Sheet (a new copy, or "New phone?" was used).\n\n'
                 'Paste your Web app URL to connect again:'),
        end(g_stale),
        ask(amount, 'Cash spent (₹)', 'Number'),
        ask(what, 'What was it for?', 'Text', 'Cash'),
        fetch(cash, tok(out(conn, 'Text')), 'POST',
              [('amount', tok(out(amount, 'Provided Input'))), ('note', tok(out(what, 'Provided Input')))]),
        as_text(cash_t, out(cash, 'Contents of URL')),
        if_(g_added, out(cash_t, 'Text'), CONTAINS, '"message"'),
        value(msg, 'message', out(cash_t, 'Text')),
        notify(tok(out(msg, 'Dictionary Value'))),
        else_(g_added),
        notify(tok("Couldn't add it. Check your internet connection and try again.")),
        end(g_added),
        end(g_sms),
    ]
    return shortcut(actions, types=['ActionExtension'])


def auto_shortcut(keywords=KEYWORDS):
    actions = [act('runworkflow', UUID=new_id(), WFInput=att(INPUT), WFWorkflowName='Spend Tracker',
                   WFWorkflow={'isSelf': False, 'workflowIdentifier': new_id(), 'workflowName': 'Spend Tracker'})]
    triggers = [{
        'WFTriggerIdentifier': 'WFMessageTrigger',
        'WFTriggerUUID': new_id(),
        'WFTriggerSerializedParameters': {'WFMessageConditions': {
            'Value': {'WFActionParameterFilterPrefix': 1, 'WFContentPredicateBoundedDate': False,
                      'WFActionParameterFilterTemplates': [{
                          'Operator': 1, 'Property': 'Message', 'Removable': False,
                          'Values': {'Text': k}}]},  # no Sender key: an iPhone-made one has none
            'WFSerializationType': 'WFContentPredicateTableTemplate'}},
    } for k in keywords]
    return shortcut(actions, triggers=triggers, types=['WFWorkflowTypeShowInSearch'], inputs=ALL_INPUT)


def shortcut(actions, import_questions=(), triggers=(), types=(), inputs=('WFStringContentItem',)):
    d = {
        'WFQuickActionSurfaces': [],
        'WFWorkflowActions': actions,
        'WFWorkflowClientVersion': '5037.109',
        'WFWorkflowHasOutputFallback': False,
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 61440, 'WFWorkflowIconStartColor': -314141441},
        'WFWorkflowImportQuestions': list(import_questions),
        'WFWorkflowInputContentItemClasses': list(inputs),
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': list(types),
    }
    if triggers:
        d['WFWorkflowTriggers'] = list(triggers)
    return d


def write_signed(name, data):
    raw = os.path.join(HERE, name + '.unsigned.shortcut')
    with open(raw, 'wb') as fh:
        plistlib.dump(data, fh, fmt=plistlib.FMT_BINARY)
    dest = os.path.join(OUT, name + '.shortcut')
    subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', raw, '--output', dest], check=True)
    os.remove(raw)
    print('wrote', dest)


if __name__ == '__main__':
    write_signed('Spend Tracker', main_shortcut())
    # One automation with a trigger per keyword. Tested on iOS 26: all triggers kept, arrives switched on.
    write_signed('Spend Tracker Auto', auto_shortcut(KEYWORDS))
