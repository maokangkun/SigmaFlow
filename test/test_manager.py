import unittest
from unittest.mock import patch, MagicMock
from pathlib import Path
from sigmaflow.manager import PromptManager

# filepath: gits/SigmaFlow/sigmaflow/test_manager.py

class TestPromptManager(unittest.TestCase):
    @patch('sigmaflow.manager.log')
    @patch('sigmaflow.manager.Prompt')
    @patch('sigmaflow.manager.importpath')
    def test_initialization_with_default_dir(self, mock_importpath, mock_prompt, mock_log):
        pm = PromptManager()
        self.assertEqual(pm.prompts_dir, Path('.'))
        self.assertTrue(mock_log.debug.called)

    @patch('sigmaflow.manager.log')
    @patch('sigmaflow.manager.Prompt')
    @patch('sigmaflow.manager.importpath')
    def test_initialization_with_custom_dir(self, mock_importpath, mock_prompt, mock_log):
        custom_dir = '/custom/prompts'
        pm = PromptManager(prompts_dir=custom_dir)
        self.assertEqual(pm.prompts_dir, Path(custom_dir))
        self.assertTrue(mock_log.debug.called)

    @patch('sigmaflow.manager.log')
    @patch('sigmaflow.manager.Prompt')
    @patch('sigmaflow.manager.importpath')
    def test_load_prompts(self, mock_importpath, mock_prompt, mock_log):
        mock_importpath.return_value = MagicMock(prompt="test_prompt", keys=["key1", "key2"])
        mock_prompt.return_value = MagicMock()

        pm = PromptManager()
        pm.buildin_prompts_dir = Path('/mock/build_in_prompts')
        pm.prompts_dir = Path('/mock/prompts')

        with patch('pathlib.Path.glob', return_value=[Path('mock_prompt.py')]):
            pm.load_prompts()

        self.assertIn('mock_prompt', pm.prompts)
        self.assertTrue(mock_log.debug.called)

    @patch('sigmaflow.manager.log')
    @patch('sigmaflow.manager.Prompt')
    def test_get_prompt_by_name(self, mock_prompt, mock_log):
        mock_prompt_instance = MagicMock()
        pm = PromptManager()
        pm.prompts['test_prompt'] = mock_prompt_instance

        result = pm.get('test_prompt')
        self.assertEqual(result, mock_prompt_instance)

    @patch('sigmaflow.manager.log')
    @patch('sigmaflow.manager.Prompt')
    def test_get_prompt_by_dict(self, mock_prompt, mock_log):
        mock_prompt_instance = MagicMock()
        mock_prompt.return_value = mock_prompt_instance

        pm = PromptManager()
        prompt_dict = {'prompt': 'test', 'keys': ['key1']}
        result = pm.get(prompt_dict)

        self.assertEqual(result, mock_prompt_instance)
        self.assertIn('prompt_0', pm.prompts)

    @patch('sigmaflow.manager.log')
    def test_get_prompt_not_found(self, mock_log):
        pm = PromptManager()
        with self.assertRaises(KeyError):
            pm.get('non_existent_prompt')

    @patch('sigmaflow.manager.log')
    @patch('sigmaflow.manager.Prompt')
    def test_get_prompt_duplicate_name(self, mock_prompt, mock_log):
        pm = PromptManager()
        pm.prompts['prompt_0'] = MagicMock()

        prompt_dict = {'prompt': 'test', 'keys': ['key1']}
        with self.assertRaises(AssertionError):
            pm.get(prompt_dict)

if __name__ == '__main__':
    unittest.main()