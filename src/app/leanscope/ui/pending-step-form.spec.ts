import { TestBed } from '@angular/core/testing';
import type { PendingQuestion } from '../agent-server.types';
import { LeanScopeSessionService } from '../leanscope-session.service';
import { PendingStepForm } from './pending-step-form';

describe('PendingStepForm', () => {
  async function render(question: PendingQuestion) {
    const fixture = TestBed.createComponent(PendingStepForm);
    fixture.componentRef.setInput('question', question);
    await fixture.whenStable();
    const answers: Record<string, unknown>[] = [];
    fixture.componentInstance.answered.subscribe((a) => answers.push(a));
    return { fixture, el: fixture.nativeElement as HTMLElement, answers };
  }

  it('sends a plain-text answer and leaves the question to the transcript', async () => {
    const { fixture, el, answers } = await render({
      guid: 'h1',
      question: 'What is your name?',
      schema: { properties: { message: { type: 'string' } } },
      fieldKeys: ['message'],
      required: ['message'],
    });
    expect(el.textContent).not.toContain('What is your name?');

    const button = el.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'Ada';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(button.disabled).toBe(false);

    button.click();
    expect(answers).toEqual([{ message: 'Ada' }]);
  });

  it('renders a choice as a select with its titles', async () => {
    const { el } = await render({
      guid: 'h2',
      schema: {
        properties: {
          plan: {
            oneOf: [
              { const: 'a', title: 'Plan A' },
              { const: 'b', title: 'Plan B' },
            ],
          },
        },
      },
      fieldKeys: ['plan'],
      required: [],
    });
    const options = Array.from(el.querySelectorAll('option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Choose…', 'Plan A', 'Plan B']);
  });

  it('parks a picked file and answers with its ref', async () => {
    const parkFile = vi.fn((file: File) => `pending://1/${file.name}`);
    TestBed.configureTestingModule({
      providers: [{ provide: LeanScopeSessionService, useValue: { parkFile } }],
    });
    const { fixture, el, answers } = await render({
      guid: 'h3',
      schema: {
        properties: { document: { type: 'string', format: 'data-url', contentMediaType: 'text/markdown' } },
      },
      fieldKeys: ['document'],
      required: ['document'],
    });

    const input = el.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('text/markdown');
    const file = new File(['# Leitfaden'], 'leitfaden.md');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    (el.querySelector('button') as HTMLButtonElement).click();
    expect(parkFile).toHaveBeenCalledWith(file);
    expect(answers).toEqual([{ document: 'pending://1/leitfaden.md' }]);
  });
});
