import {
  displayTitle,
  mentionSuggestions,
  mentionToken,
  splitLeadingMentions,
  withMentionText,
} from '../config';

describe('mentions', () => {
  const alb = { kind: 'HTTPProxy', name: 'web-alb', apiGroup: 'networking.datumapis.com' };

  it('puts the literal token in front of the prompt once', () => {
    expect(mentionToken(alb)).toBe('@HTTPProxy/web-alb');
    expect(withMentionText('Is it healthy?', [alb])).toBe('@HTTPProxy/web-alb Is it healthy?');
    expect(withMentionText('Is @HTTPProxy/web-alb healthy?', [alb])).toBe('Is @HTTPProxy/web-alb healthy?');
    expect(withMentionText('Hi', [])).toBe('Hi');
  });

  it('splits leading tokens back out for chips and titles', () => {
    expect(splitLeadingMentions('@HTTPProxy/web-alb @Workload/api Why?')).toEqual({
      mentions: [
        { kind: 'HTTPProxy', name: 'web-alb' },
        { kind: 'Workload', name: 'api' },
      ],
      text: 'Why?',
    });
    expect(splitLeadingMentions('Email me@x.com/y')).toEqual({ mentions: [], text: 'Email me@x.com/y' });
    expect(displayTitle('@HTTPProxy/web-alb Is this load balancer healthy?')).toBe('Is this load balancer healthy?');
    expect(displayTitle('Plain title')).toBe('Plain title');
  });

  it('suggests read-only questions about the resource', () => {
    expect(mentionSuggestions(alb)[0]).toBe('Is this load balancer healthy?');
    expect(mentionSuggestions({ kind: 'DNSZone' })[1]).toBe("Summarize this DNS zone's configuration.");
  });
});
