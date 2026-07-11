// Ground-truthed directly from frontend/public/signs/*.mp4 filenames — not assumed from
// the legacy README's inaccurate "200+ pre-rendered sign videos" claim (real count: 151).
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '0123456789'.split('');

const WORDS = [
  'After', 'Again', 'Against', 'Age', 'All', 'Alone', 'Also', 'And', 'Ask', 'At',
  'Be', 'Beautiful', 'Before', 'Best', 'Better', 'Busy', 'But', 'Bye',
  'Can', 'Cannot', 'Change', 'College', 'Come', 'Computer',
  'Day', 'Distance', 'Do', 'Do Not', 'Does Not',
  'Eat', 'Engineer',
  'Fight', 'Finish', 'From',
  'Glitter', 'Go', 'God', 'Gold', 'Good', 'Great',
  'Hand', 'Hands', 'Happy', 'Hello', 'Help', 'Her', 'Here', 'His', 'Home', 'Homepage', 'How',
  'Invent', 'It',
  'Keep',
  'Language', 'Laugh', 'Learn',
  'ME', 'More', 'My',
  'Name', 'Next', 'Not', 'Now',
  'Of', 'On', 'Our', 'Out',
  'Pretty',
  'Right',
  'Sad', 'Safe', 'See', 'Self', 'Sign', 'Sing', 'So', 'Sound', 'Stay', 'Study',
  'Talk', 'Television', 'Thank', 'Thank You', 'That', 'They', 'This', 'Those', 'Time', 'To', 'Type',
  'Us',
  'Walk', 'Wash', 'Way', 'We', 'Welcome', 'What', 'When', 'Where', 'Which', 'Who', 'Whole', 'Whose', 'Why', 'Will', 'With', 'Without', 'Words', 'Work', 'World', 'Wrong',
  'You', 'Your', 'Yourself',
];

const VOCABULARY = [...DIGITS, ...LETTERS, ...WORDS].sort((a, b) => a.localeCompare(b));

const FINGERSPELL_CANDIDATES = [...LETTERS, ...DIGITS];

module.exports = { LETTERS, DIGITS, WORDS, VOCABULARY, FINGERSPELL_CANDIDATES };
