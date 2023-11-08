import {autoPlacement, autoUpdate, computePosition} from '@floating-ui/dom';
import {AsYouType, CountryCode, CountryCallingCode, getCountries, getCountryCallingCode} from 'libphonenumber-js/max';
import {StyleHelpers} from './helpers';
import {countries} from './countries';
import styles from './PhoneNumber.scss';

// @ts-ignore
const gettext = window.gettext ?? function(s) { return s; };


class PhoneNumberField {
	private readonly inputElement: HTMLInputElement;
	private readonly textBox: HTMLElement;
	private readonly editField: HTMLElement;
	private readonly baseSelector = '[is="django-phone-number"]';
	private hasFocus = false;
	private readonly defaultCountryCode: CountryCode | undefined;
	private readonly mobileOnly: boolean;
	private readonly asYouType: AsYouType;
	private readonly internationalOpener: HTMLElement;
	private readonly internationalSelector: HTMLElement;
	private readonly codeCountryMap: [string, CountryCallingCode, CountryCode][];
	private isOpen = false;
	private isPristine = true;
	private cleanup?: Function;

	constructor(element: HTMLInputElement) {
		this.inputElement = element;
		this.codeCountryMap = getCountries().map(
			countryCode => [gettext(countries.get(countryCode)) ?? countryCode, getCountryCallingCode(countryCode), countryCode]
		);
		const compare = new Intl.Collator(document.documentElement.lang ?? 'en').compare;
		this.codeCountryMap = this.codeCountryMap.sort(
			(a, b)	=> compare(a[0], b[0])
		);
		const countryCode = element.getAttribute('default-country-code') as CountryCode | undefined;
		this.defaultCountryCode = countryCode ? countryCode.toUpperCase() as CountryCode : undefined;
		this.mobileOnly = element.hasAttribute('mobile-only');
		this.asYouType = new AsYouType(this.defaultCountryCode);
		this.textBox = this.createTextBox();
		this.editField = this.textBox.querySelector('.phone-number-edit')!;
		this.internationalOpener = this.textBox.querySelector('.international-picker')!;
		this.internationalSelector = this.textBox.nextElementSibling as HTMLElement;
		this.installEventHandlers();
		if (!StyleHelpers.stylesAreInstalled(this.baseSelector)) {
			this.transferStyles();
		}
		this.transferClasses();
		if (element.value) {
			this.editField.innerText = this.asYouType.input(element.value);
			element.value = this.asYouType.getNumberValue() ?? element.value;  // enforce E.164 format
			this.decorateInputField(this.asYouType.getCountry());
		}
	}

	private createTextBox() {
		const htmlTags = [
			'<div role="textbox" aria-expanded="false" aria-haspopup="dialog">',
			'<div class="international-picker"></div>',
			'<div class="phone-number-edit" contenteditable="true"></div>',
			'</div>',
			'<div role="dialog" aria-modal="true">', '<ul>',
		];
		for (let [countryName, callingCode, countryCode] of this.codeCountryMap) {
			htmlTags.push(`<li data-country="${countryCode}" data-calling-code="${callingCode}">`);
			htmlTags.push(`<span class="fi fi-${countryCode.toLowerCase()} fib"></span>${countryName} <strong>+${callingCode}</strong>`);
			htmlTags.push('</li>');
		}
		htmlTags.push('</div>');
		this.inputElement.insertAdjacentHTML('afterend', htmlTags.join(''));
		return this.inputElement.nextElementSibling as HTMLElement;
	}

	private installEventHandlers() {
		this.editField.addEventListener('focus', this.handleFocus);
		this.editField.addEventListener('input', this.handleInput);
		this.editField.addEventListener('blur', this.handleBlur);
		document.addEventListener('click', this.handleClick);
		document.addEventListener('keydown', this.handleKeypress);
	}

	private handleFocus = (event: Event) => {
		if (this.editField !== event.target)
			return;
		this.editField.ariaBusy = 'true';
		this.textBox.classList.add('focus');
		this.inputElement.dispatchEvent(new Event('focus'));
		event.preventDefault();
		this.hasFocus = true;
	}

	private setCaretToEnd() {
		const textNode = this.editField.childNodes[0] as Text;
		if (!textNode)
			return;
		const range = document.createRange();
		range.setStart(textNode, textNode.length);
		range.collapse(true);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
	}

	private handleInput = (event: Event) => {
		if (event.target instanceof HTMLElement && this.editField === event.target) {
			if (this.editField.innerText === '') {
				this.isPristine = true;
			} else {
				this.updateInputField(event.target.innerText);
			}
		}
	}

	private handleBlur = () => {
		setTimeout(() => {
			if (this.hasFocus) {
				this.editField.ariaBusy = 'false';
				this.textBox.classList.remove('focus');
				this.hasFocus = false;
				this.inputElement.dispatchEvent(new Event('blur'));
			}
		}, 0);
	}

	private handleClick = (event: Event) => {
		let countryCode: string | null = null;
		let callingCode: string | null = null;
		let element = event.target instanceof Element ? event.target : null;
		while (element) {
			if (element.hasAttribute('data-country')) {
				countryCode = element.getAttribute('data-country');
				callingCode = element.getAttribute('data-calling-code');
			}
			if (element === this.internationalSelector && countryCode && callingCode) {
				this.setInternationalCode(countryCode as CountryCode, callingCode as CountryCallingCode);
				break;
			}
			if (element === this.internationalOpener) {
				this.openInternationalSelector();
				return;
			}
			element = element.parentElement;
		}
		this.closeInternationalSelector();
	}

	private handleKeypress = (event: KeyboardEvent) => {
		const selectElement = (element: HTMLLIElement) => {
			this.deselectAll();
			element.classList.add('selected');
			element.scrollIntoView();
		};

		if (!this.isOpen)
			return;
		switch (event.key) {
			case 'Enter':
				const element = this.internationalSelector.querySelector('li[data-country].selected');
				if (element instanceof HTMLLIElement) {
					const countryCode = element.getAttribute('data-country');
					const callingCode = element.getAttribute('data-calling-code');
					this.closeInternationalSelector();
					this.setInternationalCode(countryCode as CountryCode, callingCode as CountryCallingCode);
				}
				break;
			case 'Escape':
				this.closeInternationalSelector();
				break;
			case 'ArrowUp':
				let prev = this.internationalSelector.querySelector('li[data-country].selected')?.previousElementSibling;
				if (!prev) {
					prev = this.internationalSelector.querySelector('li[data-country]:last-child');
				}
				if (prev instanceof HTMLLIElement) {
					selectElement(prev);
				}
				event.preventDefault();
				break;
			case 'ArrowDown':
				let next = this.internationalSelector.querySelector('li[data-country].selected')?.nextElementSibling;
				if (!next) {
					next = this.internationalSelector.querySelector('li[data-country]:first-child');
				}
				if (next instanceof HTMLLIElement) {
					selectElement(next);
				}
				event.preventDefault();
				break;
			case '+': case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
				this.closeInternationalSelector();
				this.editField.focus();
				this.updateInputField(event.key);
				event.preventDefault();
				break;
			default:
				break;
		}
	}

	private updatePosition = () => {
		const zIndex = this.textBox.style.zIndex ? parseInt(this.textBox.style.zIndex) : 0;
		computePosition(this.textBox, this.internationalSelector, {
			middleware: [autoPlacement()],
		}).then(() => Object.assign(
			this.internationalSelector.style, {zIndex: `${zIndex + 1}`}
		));
	}

	private deselectAll = () => {
		this.internationalSelector.querySelectorAll('li[data-country].selected').forEach(element => {
			element.classList.remove('selected');
		});
	};

	private openInternationalSelector() {
		this.internationalSelector.parentElement!.style.position = 'relative';
		this.cleanup = autoUpdate(this.textBox, this.internationalSelector, this.updatePosition);
		this.textBox.setAttribute('aria-expanded', 'true');
		this.isOpen = true;
		this.isPristine = true;
		this.deselectAll();
		const country = this.asYouType.getCountry();
		if (country) {
			const liElem = this.internationalSelector.querySelector(`[data-country="${country}"]`);
			if (liElem instanceof HTMLLIElement) {
				liElem.classList.add('selected');
				liElem.scrollIntoView();
			}
		}
	}

	private closeInternationalSelector() {
		this.isOpen = false;
		this.textBox.setAttribute('aria-expanded', 'false');
		this.cleanup?.();
	}

	private setInternationalCode(countryCode: CountryCode, callingCode: CountryCallingCode) {
		this.decorateInputField(countryCode);
		const nationalNumber = this.asYouType.getNumber()?.nationalNumber ?? '';
		this.decorateInputField(countryCode);
		this.editField.innerText = `+${callingCode}${nationalNumber}`;
		this.editField.focus();
		window.setTimeout(() => {
			this.setCaretToEnd();
		}, 0);
	}

	private updateInputField(phoneNumber: string) {
		this.asYouType.reset();
		if (!this.defaultCountryCode && this.isPristine) {
			this.isPristine = false;
			if (!phoneNumber.startsWith('+')) {
				if (phoneNumber.startsWith('0')) {
					phoneNumber = '';
				}
				this.editField.innerText = this.asYouType.input('+');
				this.setCaretToEnd();
			}
		}
		const selection = window.getSelection()!;
		let caretPosition = selection.rangeCount ? selection.getRangeAt(0).startOffset : 0;
		if (this.editField.innerText.length === caretPosition) {
			++caretPosition;
		}
		this.editField.innerText = this.asYouType.input(phoneNumber);
		const textNode = this.editField.childNodes[0] as Text;
		const range = document.createRange();
		range.setStart(textNode, Math.min(caretPosition, textNode.length));
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		this.inputElement.value = this.asYouType.getNumberValue() ?? '';
		this.decorateInputField(this.asYouType.getCountry());
		this.inputElement.dispatchEvent(new Event('input'));
	}

	private decorateInputField(countryCode?: CountryCode) {
		if (countryCode) {
			this.internationalOpener.innerHTML = `<span class="fi fi-${countryCode.toLowerCase()} fib"></span>`;
		} else {
			this.internationalOpener.innerHTML = '';
		}
	}

	private transferStyles() {
		const declaredStyles = document.createElement('style');
		let loaded = false;
		declaredStyles.innerText = styles;
		document.head.appendChild(declaredStyles);
		this.inputElement.style.transition = 'none';  // prevent transition while pilfering styles
		for (let index = 0; declaredStyles.sheet && index < declaredStyles.sheet.cssRules.length; index++) {
			const cssRule = declaredStyles.sheet.cssRules.item(index) as CSSStyleRule;
			let extraStyles: string;
			switch (cssRule.selectorText) {
				case this.baseSelector:
					loaded = true;
					break;
				case `${this.baseSelector} + [role="textbox"]`:
					extraStyles = StyleHelpers.extractStyles(this.inputElement, [
						'background-color', 'border', 'border-radius', 'color', 'outline', 'height', 'line-height',
						'padding'
					]);
					declaredStyles.sheet.insertRule(`${cssRule.selectorText}{${extraStyles}}`, ++index);
					break;
				case `${this.baseSelector} + [role="textbox"].focus`:
					this.inputElement.classList.add('-focus-');
					extraStyles = StyleHelpers.extractStyles(this.inputElement, [
						'background-color', 'border', 'box-shadow', 'color', 'outline', 'transition']);
					this.inputElement.classList.remove('-focus-');
					declaredStyles.sheet.insertRule(`${cssRule.selectorText}{${extraStyles}}`, ++index);
					break;
				case `${this.baseSelector} + [role="textbox"][aria-haspopup="dialog"] + [role="dialog"]`:
					extraStyles = StyleHelpers.extractStyles(this.inputElement, [
						'background-color', 'border-radius', 'color', 'line-height', 'padding']);
					declaredStyles.sheet.insertRule(`${cssRule.selectorText}{${extraStyles} height:${Math.floor(window.innerHeight / 3)}px;`, ++index);
					break;
				default:
					break;
			}
		}
		this.inputElement.style.transition = '';
		if (!loaded)
			throw new Error(`Could not load styles for ${this.baseSelector}`);
	}

	private transferClasses() {
		this.inputElement.classList.remove(...this.inputElement.classList);
		this.inputElement.style.transition = '';
		this.inputElement.hidden = true;  // setting type="hidden" prevents dispatching events
	}

	public checkValidity() : boolean {
		if (this.asYouType.isValid()) {
			if (this.mobileOnly && this.asYouType.getNumber()?.getType() !== 'MOBILE') {
				this.inputElement.setCustomValidity("Invalid mobile number");
				return false;
			}
		} else {
			this.inputElement.setCustomValidity("Invalid phone number");
			return false;
		}
		return true;
	}
}


const PN = Symbol('DjangoPhoneNumberElement');

export class PhoneNumberElement extends HTMLInputElement {
	private [PN]!: PhoneNumberField;  // hides internal implementation

	connectedCallback() {
		this[PN] = new PhoneNumberField(this);
	}

	public checkValidity() {
		if (!super.checkValidity())
			return false;
		return this[PN].checkValidity();
	}
}