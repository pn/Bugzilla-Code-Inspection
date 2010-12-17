========================
Bugzilla Code Inspection
========================

`Bugzilla Code Inspection`_ web browser script adds code inspection functionality to Bugzilla_ + Subversion_ + ScmBug_ + viewvc_ (this software combination is currently supported).
In that configuration every commit must be associated with a bug. Appropriate comment is appended to the bug including hyperlinks to diffs.
The goal of this project is to unclutter Bugzilla page and make it more useful for performing code reviews.

Features
========

- Summary of all changes made with a bug with single entry for each file
  in each branch
- Shorten links to contain only relevant path inside repository
- Collapse unneeded comments (by specified user, commit messages)
- Allow to post code inspection comments with different severity for specified
  file and line number
- Bugzilla comments can be displayed on the diff page (using `http referer`_).
  Comments for specified line are available near that line and global comments
  for specific file at the top of the page.
- Allow to give 'accepted' disposition for the review, users that gave this
  disposition will be listed in the summary
- Check from bug list page if a given bug received 'accepted' disposition
- Add hyperlink that, when clicked, will open email client with invitation
  for the review ready to be sent. It will contain link to the bug, will be
  addressed to everyone on the CC of the bug and will contain preconfigured
  addresses on CC.
- Display notification on bugzilla page of new version of the script available
  and allow to download it.

.. _`Bugzilla Code Inspection`: https://github.com/pn/Bugzilla-Code-Inspection
.. _Bugzilla: http://www.bugzilla.org
.. _Subversion: http://subversion.tigris.org
.. _ScmBug: http://www.mkgnu.net/scmbug
.. _viewvc: http://www.viewvc.org
.. _`http referer`: http://en.wikipedia.org/wiki/HTTP_referrer

Installation
============
#. Install Greasemonkey_ extension for Firefox_

#. Install bugzilla-ci.user.js_ script in Greasemonkey.

.. _Greasemonkey: https://addons.mozilla.org/en-US/firefox/addon/748/
.. _Firefox: http:/www.mozilla.com/firefox/
.. _bugzilla-ci.user.js: https://github.com/pn/Bugzilla-Code-Inspection/blob/master/bugzilla-ci.user.js

Versions
========

- 0.14:
   - fix regression for displaying links in summary
   - reset Code Inspected flag to false if bug reopened
- 0.13:
   - prevent author from setting Code Inspected flag
   - prevent author from changing bug state to FIXED before CI flag is set
   - fix issue for new file updated with second commit
   - first change to make the script work under Chrome
- 0.12:
   -first open source release

Bugs
====

See: https://github.com/pn/Bugzilla-Code-Inspection/issues
