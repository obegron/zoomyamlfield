import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { __testing } from '../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Keeps dotted keys quoted in paths', () => {
		const path = __testing.formatYamlPath(['data', 'settings.xml']);

		assert.strictEqual(path, 'data."settings.xml"');
		assert.deepStrictEqual(__testing.parseYamlPath(path), ['data', 'settings.xml']);
	});

	test('Reads and writes dotted keys as a single segment', () => {
		const doc = {
			data: {
				'settings.xml': 'old value'
			}
		};
		const path = 'data."settings.xml"';

		assert.strictEqual(__testing.getNestedValue(doc, path), 'old value');
		__testing.setNestedValue(doc, path, 'new value');
		assert.strictEqual(doc.data['settings.xml'], 'new value');
		assert.strictEqual((doc.data as Record<string, unknown>).settings, undefined);
	});
});
