// ==UserScript==
// @name           bugzilla-ci
// @author         Paweł Nadolski
// @description    adds code inspection functionality to Bugzilla + ScmBug + viewvc
// @include        http://*bugzilla*
// @include        http://*viewvc*
//
// Copyright(c) 2010 Paweł Nadolski
// License GPLv3
// ==/UserScript==

//**************************
//script configuration start
var version = '0.14';
var project_url = ''; //TODO: add project url to be put in the email
var ci_email_body = "You are invited to participate in a code inspection of:%0a{title}%0a%0a{url}%0a%0a-- %0aGenerated by CI tool v"+version+"%0a"+project_url;
var ci_email_subject_prefix = '[CI] ';
var hide_viewvc = true; //true if viewvc comments should be collapsed
var is_bug_list = false; //true if bugzilla shows list of bugs
var collapse_bugzilla_user = ''; //name of administrative user who's comments will be collapsed
var collapse_user_flag = true; //true if comments by collapse_bugzilla_user should be collapsed
var email_separator = ';'; //works with outlook, may need to change to ',' for thunderbird

var is_ci_accepted = false;
var ci_comments_num = 0;
var r1_pattern = /r1=(\d+)/;
var r2_pattern = /r2=(\d+)/;
var revision_pattern = /revision=(\d+)/;
var viewvc_pattern = /^http.*viewvc\/(.*)/;
//example:
var ci_severity = ['major', 'normal', 'minor', 'style'];
var ci_severity_re = new RegExp('severity:(major|normal|minor|style)');
var ci_line_re = new RegExp('line:([^ ]+)');
var ci_file_re = new RegExp('file:([^ ]+)');
var ci_rev_re = new RegExp('rev:([^ ]+)');
var ci_sev_re = new RegExp('severity:([^ ]+)');
//--- CI comment severity:style line:123 ---
var ci_comment_re = /--- CI comment .*---/;
var ci_accepted_re = /--- CI accepted ---/;
var ci_cc_list = ''; //TODO
var script_update_source = ''; //TODO: url of latest version of the script
var ver_re = /version[^=]*=[^=]*(\d+\.\d+)[^\d]/;
var bz_comment_ci = 'bz_comment_ci';
var bug_processed = /Bug \d+ processed/;

//define svn layout patterns, trunk is mandatory
// regular expression should match: 1.product name, 2.branch type
var gen_trunk_pat = new RegExp(/([^\/]+)\/(trunk)\//);
// 3.branch name
var gen_branches_pat = new RegExp(/([^\/]+)\/(branches)\/([^\/]+)\//);
var gen_releases_pat = new RegExp(/([^\/]+)\/(releases)\/([^\/]+)\//);
var patterns = [];
patterns[0] = gen_trunk_pat;
patterns[1] = gen_branches_pat;
patterns[2] = gen_releases_pat;

//script configuration end
//************************

/*global GM_xmlhttpRequest, document, location, alert, window */

var ci_accepted_users = [];
var ci_comments = [];
var ci_comments_ext = [];
var ci_code_link = [];
var ci_branch_name = [];
var trunk_links_r1 = [];
var trunk_links_r2 = [];

//1 - if v2 larger than v1, -1 - if smaller, 0 - if equal
function compareVersions(v1, v2) {
  var re = /(\d+)[^\d](\d+)/;
  var m1 = v1.match(re);
  var m2 = v2.match(re);
  if(!m1 && m2) {
    return 1;
  }
  if(!m1 || !m2) {
    return 0;
  }
  for(var i=1; i<=2; i++) {
    if(parseInt(m1[i], 10) < parseInt(m2[i], 10)) {
      return 1;
    } else if(parseInt(m1[i], 10) > parseInt(m2[i], 10)) {
      return -1;
    } else if(i<2) { continue; } else { return 0; }
  }
}

function newVersionAvailable(v) {
  if(v) {
    if(compareVersions(v, version) < 0) {
      return true;
    } else {
      return false;
    }
  }
  return true; //if version not set this version must be newer
}

function getScriptUpdateVer(link) {
  if(!link) {
    return;
  }
  GM_xmlhttpRequest({
    method: 'GET',
    url: link,
    headers: {
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
      'Accept': 'text/html,application/xhtml+xml,application/xml'
    },
    onload: function(responseDetails) {
      var html = responseDetails.responseText;
      var m = html.match(ver_re);
      if(!m) {
        return;
      }
      var elem = document.getElementById(bz_comment_ci);
      if(!elem) {
        return;
      }
      var div = document.createElement('div');
      div.setAttribute('style', 'background-color: #d00');
      div.innerHTML = 'New version available. Please update by clicking ';
      var a = document.createElement('a');
      a.setAttribute('href', script_update_source);
      a.innerHTML = 'here';
      div.appendChild(a);
      div.innerHTML += ' and then reload ';
      a = document.createElement('a');
      a.setAttribute('href', document.location);
      a.innerHTML = 'reload';
      div.appendChild(a);
      div.innerHTML += ' page.';
      if(newVersionAvailable(m[1])) {
        elem.parentNode.insertBefore(div, elem);
      }
    }
  });
}

function getElementByClassName(e, tag, class_name) {
  var elements = e.getElementsByTagName(tag);
  for(var i=0; i<elements.length; i++) {
    if(elements[i].className == class_name) {
      return elements[i];
    }
  }
  return null;
}

function gatherCIStats(doc) {
  var comments = doc.getElementsByClassName('bz_comment_text');
  ci_accepted_users = [];
  is_ci_accepted = false;
  for(var i=0; i<comments.length; i++) {
    var comment = comments[i];
    ci_comments_ext[i] = {'is_ci': false, file: '', rev: 0, line: 0, text: '',
      vcard_node: null, num_node: null, severity: null};
    ci_comments_ext[i].text = comment.innerHTML.replace(/--- CI comment .*---/, '');
    if(comment.innerHTML.match(ci_accepted_re)) {
      is_ci_accepted = true;
      ci_accepted_users[getElementByClassName(comment.parentNode, 'span', 'fn').innerHTML] = true;
    }
    var m1;
    ci_comments_ext[i].is_ci = false;
    m1 = comment.innerHTML.match(ci_comment_re);
    if(m1) {
      ci_comments_ext[i].is_ci = true;
      var m2, line, file;
      m2 = m1[0].match(ci_file_re);
      if(m2) {
        file=m2[1];
        ci_comments_ext[i].file = file;
      }
      m2 = m1[0].match(ci_line_re);
      if(m2) {
        line=m2[1];
        ci_comments_ext[i].line = line;
      }
      m2 = m1[0].match(ci_rev_re);
      if(m2) {
        ci_comments_ext[i].rev = m2[1];
      }
      m2 = m1[0].match(ci_sev_re);
      if(m2) {
        ci_comments_ext[i].severity = m2[1];
      }
      if(!ci_comments[file]) {
        ci_comments[file] = [];
        ci_comments[file][0] = line;
      }
      ci_comments_num++;
      ci_comments_ext[i].vcard_node = getElementByClassName(comment.parentNode, 'span', 'vcard');
      ci_comments_ext[i].num_node = getElementByClassName(comment.parentNode, 'span', 'bz_comment_number');
    }
  }
}

var viewvc_match = location.pathname.match(/^\/viewvc\/(.*)/);
if(viewvc_match) {
  var matched_comments = [];
  var file = viewvc_match[1] +'/'+ viewvc_match[2];
  var is_viewvc = true;
  var rev_path_re = new RegExp('r2=([^&#]*)');
  var rev = location.search.match(rev_path_re)[1];
}

if(viewvc_match) {
  //place javascript inside page
  var scriptElement = document.createElement('script');
  scriptElement.type = 'text/javascript';

  scriptElement.innerHTML = "function setVisible(obj) " +
"{ " +
"  var className = 'permanent';  " +
"  var pattern = new RegExp('(^|\\s)'+className+'(\\s|$)');  " +
"	obj = document.getElementById(obj); " +
"  if(!obj.className.match(pattern)) { " +
"	  obj.style.visibility = (obj.style.visibility == 'visible') ? 'hidden' : 'visible'; " +
"  } else alert(obj.className.match(className));  " +
"  return false;" +
"}  " +
"function toggleClass(id) {  " +
"  var className = 'permanent';  " +
"  var pattern = new RegExp('(^|\\s)'+className+'(\\s|$)');  " +
"  var match;  " +
"  var elem = document.getElementById(id);  " +
"  if(match = elem.className.match(pattern))  " +
"    elem.className = elem.className.replace(className, '');  " +
"  else  " +
"    elem.className = elem.className + ' ' + className;  " +
"}";

  document.getElementsByTagName("head")[0].appendChild(scriptElement);
} else {
  //place javascript inside page
  var scriptElement = document.createElement('script');
  scriptElement.type = 'text/javascript';

  scriptElement.innerHTML = "function setVisible(obj) " +
"{ " +
"  var className = 'permanent';  " +
"  var pattern = new RegExp('(^|\\s)'+className+'(\\s|$)');  " +
"	obj = document.getElementById(obj); " +
"  if(!obj.className.match(pattern)) { " +
"	  obj.style.display = (obj.style.display == 'inline') ? 'none' : 'inline'; " +
"  } else alert(obj.className.match(className));  " +
"  return false;" +
"}  " +
"function toggleClass(id) {  " +
"  var className = 'permanent';  " +
"  var pattern = new RegExp('(^|\\s)'+className+'(\\s|$)');  " +
"  var match;  " +
"  var elem = document.getElementById(id);  " +
"  if(match = elem.className.match(pattern))  " +
"    elem.className = elem.className.replace(className, '');  " +
"  else  " +
"    elem.className = elem.className + ' ' + className;  " +
"}";

  document.getElementsByTagName("head")[0].appendChild(scriptElement);
}

if(viewvc_match) {
  if(document.referrer) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: document.referrer,
      headers: {
        'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
        'Accept': 'text/html,application/xhtml+xml,application/xml'
      },
      onload: function(responseDetails) {

        var html = responseDetails.responseText;
        var temp_div = document.createElement('div');
        temp_div.innerHTML = html.replace(/<script(.|\s)*?\/script>/g, '');
        gatherCIStats(temp_div);

        //find first line where general comments will be anchored
        var first_line = getElementByClassName(document, 'td', 'vc_diff_line_number');
        first_line.appendChild(document.createTextNode(' '));

        for(var i=0; i<ci_comments_ext.length; i++) {
          if(ci_comments_ext[i].is_ci && ci_comments_ext[i].rev == rev) {
            if(!ci_comments_ext[i].line) {
              ci_comments_ext[i].line = 0;
            }
            if(ci_comments_ext[i].file === file) {
              var j;
              for(j=0; j<matched_comments.length; j++) {
                if(matched_comments[j].line == ci_comments_ext[i].line) {
                  break;
                }
              }
              //define new comment appended to the page
              if(j>=matched_comments.length) {
                matched_comments[j] = {'line': ci_comments_ext[i].line, elem: document.createElement('div')};
                matched_comments[j].elem.setAttribute('style', 'visibility: hidden; position: absolute; background-color: #ccc; border: 1px solid #000; padding: 10px; left: 60px');
                matched_comments[j].elem.setAttribute('id', 'ci'+ci_comments_ext[i].line);
                var a = document.createElement('a');
                a.setAttribute('href', '#');
                a.setAttribute('onMouseDown', 'setVisible(\'ci'+ci_comments_ext[i].line+'\')');
                var line_elem = document.getElementById('l'+matched_comments[j].line);
                if(line_elem) {
                  line_elem.appendChild(document.createTextNode(' '));
                  line_elem.appendChild(a);
                  a.setAttribute('style', 'background-color: rgb(255, 255, 0);');
                  a.innerHTML = 'CI';
                } else {
                  first_line.appendChild(document.createTextNode(' '));
                  first_line.appendChild(a);
                  a.setAttribute('style', 'background-color: rgb(155, 155, 0);');
                  a.innerHTML = 'GCI';
                }

              }
              var e = document.createElement('div');
              matched_comments[j].elem.appendChild(ci_comments_ext[i].num_node);
              matched_comments[j].elem.appendChild(document.createTextNode('by '));
              matched_comments[j].elem.appendChild(ci_comments_ext[i].vcard_node);
              var severity = ci_comments_ext[i].severity;
              if(severity) {
                var span = document.createElement('span');
                matched_comments[j].elem.appendChild(document.createTextNode('('));
                span.appendChild(document.createTextNode(severity));
                switch (severity) {
                  case 'style': span.setAttribute('style', 'color: #00DD00'); break;
                  case 'minor': span.setAttribute('style', 'color: #0000DD'); break;
                  case 'major': span.setAttribute('style', 'color: #DD0000'); break;
                  case 'normal':span.setAttribute('style', 'color: #000000'); break;
                  default:
                }
                matched_comments[j].elem.appendChild(span);
                matched_comments[j].elem.appendChild(document.createTextNode(')'));
              }
              matched_comments[j].elem.appendChild(document.createTextNode(': '));
              e.innerHTML = ci_comments_ext[i].text;
              matched_comments[j].elem.appendChild(e);
              matched_comments[j].elem.appendChild(document.createElement('br'));
            }
          }
        }
        for(var k=0; k<matched_comments.length; k++) {
          var line_elem2 = document.getElementById('l'+matched_comments[k].line);
          if(line_elem2) {
            line_elem2.appendChild(matched_comments[k].elem);
          } else {
            if(first_line) {
              first_line.appendChild(matched_comments[k].elem);
              alert('not found');
            }
          }
        }
      }
    });
  }
}

var scriptElement = document.createElement('script');
scriptElement.type = 'text/javascript';

//function gatherCIStatsByURL(href, elem) {
scriptElement.innerHTML = "var ci_comments_ext = [];  " +
"var is_ci_accepted;  " +
"var ci_accepted_re = /--- CI accepted ---/;  " +
"var ci_comment_re = /--- CI comment .*---/;  " +
"var ci_file_re = new RegExp('file:([^ ]+)');  " +
"var ci_elem;  " +
"var req = new XMLHttpRequest();  " +
"  " +
"function getElementByClassName(e, tag, class_name) {  " +
"  var elements = e.getElementsByTagName(tag);  " +
"  for(var i=0; i<elements.length; i++) {  " +
"    if(elements[i].className == class_name)  " +
"      return elements[i];  " +
"  }  " +
"  return null;  " +
"}  " +
"  " +
"function gatherCIStats(doc) {  " +
"  var comments = doc.getElementsByClassName('bz_comment_text');  " +
"  is_ci_accepted = false;  " +
"  for(var i=0; i<comments.length; i++) {  " +
"    var comment = comments[i];  " +
"    ci_comments_ext[i] = {'is_ci': false, file: '', rev: 0, line: 0, text: '',  " +
"      vcard_node: null, num_node: null, severity: null};  " +
"    ci_comments_ext[i].text = comment.innerHTML.replace(/--- CI comment .*---/, '');  " +
"    if(comment.innerHTML.match(ci_accepted_re)) {  " +
"      is_ci_accepted = true;  " +
"    }  " +
"  }  " +
"}  " +
"  " +
"function statechanged(responseDetails) {  " +
"  if(req.readyState == 4 && req.status == 200) {  " +
"    var html = req.responseText;  " +
"    temp_div = document.createElement('div');  " +
"    temp_div.innerHTML = html.replace(/<script(.|\\s)*?\\/script>/g, '');  " +
"    gatherCIStats(temp_div);  " +
"    var e = document.getElementById(ci_elem);  " +
"    if(e) {  " +
"      if(is_ci_accepted)  " +
"        e.innerHTML = 'accepted';  " +
"      else  " +
"        e.innerHTML = 'not accepted';  " +
"    }  " +
"  }  " +
"}  " +
"  " +
"function gatherCIStatsByURL(href, elem) {  " +
"  ci_elem = elem;  " +
"  req.onreadystatechange = statechanged;  " +
"  req.open('GET', href, true);  " +
"  req.send(null);  " +
"}  " +
"  " +
"function gatherAllCIStats(aa) {  " +
"  var bz_bugitem_re = new RegExp('.*bz_bugitem.*');  " +
"  var bz_ci_td_re = new RegExp('.*ci_td.*');  " +
"  var bug_list = getElementByClassName(document, 'table', 'bz_buglist');  " +
"  var trs = bug_list.getElementsByTagName('tr');  " +
"  for(var i=0; i<trs.length; i++) {  " +
"    if(trs[i].className.match(bz_bugitem_re)) {  " +
"      var tds = trs[i].getElementsByTagName('td');  " +
"      for(var j=0; j<tds.length; j++) {  " +
"        if(tds[j].className.match(bz_ci_td_re)) {  " +
"          alert('This is workaround for race condition bug somewhere... which requires you to press enter for each bug... sorry');  " +
"          gatherCIStatsByURL(trs[i].getElementsByTagName('a')[0].href, tds[j].id);  " +
"        }  " +
"      }  " +
"    }  " +
"  }  " +
"}";



/*function gatherCIStatsByURL(href, elem) {
  xmlhttpRequest({
    method: 'GET',
    url: href,
    headers: {
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
      'Accept': 'text/html,application/xhtml+xml,application/xml',
    },
    onload: function(responseDetails) {
      var html = responseDetails.responseText;
      temp_div = document.createElement('div');
      temp_div.innerHTML = html.replace(/<script(.|\s)*?\/script>/g, '');
      gatherCIStats(temp_div);
      var e = document.getElementById(elem);
      if(e) {
        e.innerHTML = is_ci_accepted ? 'accepted' : 'not accepted';
      }
    }
  });
}*/


function bugListAddCIStatus(e) {
  var trs = e.getElementsByTagName('tr');
  var re = new RegExp('.*bz_first_buglist_header.*');
  var num = 0;
  var ae;
  for(var i=0; i<trs.length; i++) {
    if(trs[i].className.match(re)) {
      var th = document.createElement('th');
      ae = document.createElement('a');
      ae.setAttribute('href', '#');
      ae.setAttribute('onClick', 'gatherAllCIStats(\'ci_td_\');');
      ae.setAttribute('title', 'click to get all CI Statuses');
      ae.innerHTML = 'CI Status';
      th.appendChild(ae);
      trs[i].appendChild(th);
    } else {
      var td = document.createElement('td');
      td.setAttribute('class', 'ci_td');
      td.setAttribute('id', 'ci_td_'+i);
      var a = trs[i].getElementsByTagName('a');
      if(a.length > 0) {
        ae = document.createElement('a');
        ae.setAttribute('href', '#'+num);
        num+=1;
        ae.setAttribute('onClick', 'gatherCIStatsByURL(\''+a[0].href+'\', \'ci_td_'+i+'\');');
        ae.innerHTML = 'get&nbsp;status';
        td.appendChild(ae);
        trs[i].appendChild(td);
        //TODO: testing
        //gatherCIStatsByURL(a[0].href, 'ci_td_'+i);
        //TODO: delete after testing and inject used function into page
      } else {
        td.appendChild(document.createTextNode('N/A'));
        trs[i].appendChild(td);
      }
    }
  }
  //gatherAllCIStats('ci_td_');
}

is_viewvc = false;
var bug_list = getElementByClassName(document, 'table', 'bz_buglist');
if(bug_list) {
  is_bug_list = true;
  bugListAddCIStatus(bug_list);
  document.getElementsByTagName("head")[0].appendChild(scriptElement);
}

//match[1] - trunk and node
//match[2] - file path TODO: get directly from url
//match[3] - args

function arrToObjLiteral(arr) {
  var obj = [];
  for (var i=0; i<arr.length; i++) {
    obj[arr[i]] = '';
  }
  return obj;
}

var gen; //TODO: add multi generic support
var release; //TODO: add multi release support
var elements = document.getElementsByTagName('a');
for(var i=0; i< elements.length; i++) {
  var match, r1_match;
  if (!(match = viewvc_pattern.exec(elements[i].innerHTML))) {
    continue;
  }
  var file_path = match[1]; //strip protocol, host part and viewvc part
  var url_args = match[1].split('?')[1]; //extract arguments
  var file_path = match[1].split('?')[0]; //repository file path
  var short_file_path;
  var branch_path;
  var branch_type;
  var branch_name;
  for(var pi = 0; pi < patterns.length; pi++) {
    var url_parts = elements[i].innerHTML.split('?');
    var absolute_url = url_parts[0];
    var url_args = url_parts[1];
    match = patterns[pi].exec(absolute_url);
    if(match) {
      branch_path = match[0];
      branch_type = match[2];
      if (patterns[pi] != gen_trunk_pat) {
        branch_name = match[3];
        short_file_path = file_path.replace(match[0], '');
      }
      short_file_path = file_path.replace(branch_path, '');
      if(!(file_path.replace(short_file_path, '') in arrToObjLiteral(ci_branch_name))) {
        ci_branch_name.push(file_path.replace(short_file_path, ''));
      }
      if (short_file_path.match(/\/$/) || short_file_path === '') {
        continue;
      }

      r1_match = r1_pattern.exec(url_args);
      if(r1_match) {
        if(trunk_links_r1[branch_path] === undefined) {
          trunk_links_r1[branch_path] = [];
        }
        if(trunk_links_r1[branch_path][short_file_path]) {
          trunk_links_r1[branch_path][short_file_path] = Math.min(trunk_links_r1[branch_path][short_file_path], r1_match[1]);
        } else if(trunk_links_r2[branch_path] !== undefined && trunk_links_r2[branch_path][short_file_path] !== undefined) {
          trunk_links_r2[branch_path][short_file_path] = r1_match[1];
        } else {
          trunk_links_r1[branch_path][short_file_path] = r1_match[1];
        }
      }
      r1_match = r2_pattern.exec(url_args);
      if(r1_match) {
        if(trunk_links_r2[branch_path] === undefined) {
          trunk_links_r2[branch_path] = [];
        }
        if(trunk_links_r2[branch_path][short_file_path]) {
          trunk_links_r2[branch_path][short_file_path] = Math.max(trunk_links_r2[branch_path][short_file_path],
            r1_match[1]);
        } else {
          trunk_links_r2[branch_path][short_file_path] = r1_match[1];
        }
      }
      r1_match = revision_pattern.exec(url_args);
      if(r1_match) {
        if(trunk_links_r2[branch_path] === undefined) {
          trunk_links_r2[branch_path] = [];
        }
        if(trunk_links_r2[branch_path][short_file_path]) {
          trunk_links_r2[branch_path][short_file_path] = Math.max(trunk_links_r2[branch_path][short_file_path],
            r1_match[1]);
        } else {
          trunk_links_r2[branch_path][short_file_path] = r1_match[1];
        }
      }

      if(ci_code_link[branch_path] === undefined) {
        ci_code_link[branch_path] = [];
      }
      ci_code_link[branch_path][short_file_path] = absolute_url;
      elements[i].innerHTML = short_file_path;
    }
  }
}

  function bs_collapse_comment(comment_id) {
    var comment = document.getElementById('comment_text_' + comment_id);
    var link = document.getElementById('comment_link_' + comment_id);
    var re = new RegExp(/\bcollapsed\b/);
    if (!comment.className.match(re)) {
      try {
        window.wrappedJSObject.collapse_comment(link, comment);
      } catch (err) {
        //FIXME: add support for collapsing comments in google chrome
      }
    }
  }

  function collapse_user(user) {
    for(var comment_id=0; comment_id<1000; comment_id++) {
      var comment = document.getElementById('comment_text_' + comment_id);
      if(!comment) {
        break;
      }
      var elements = comment.parentNode.getElementsByTagName('span');
      for(var j=0; j < elements.length; j++) {
        if((elements[j].className == 'fn') && (elements[j].innerHTML == user)) {
          bs_collapse_comment(comment_id);
          break;
        }
      }
    }
  }

  function collapse_viewvc() {
    var re = new RegExp(/Affected files:\n---------------/);
    for(var comment_id=0; comment_id<1000; comment_id++) {
      var comment = document.getElementById('comment_text_' + comment_id);
      if(!comment) {
        break;
      }
      if(comment.parentNode.innerHTML.match(re)) {
        bs_collapse_comment(comment_id);
      }
    }
  }
if(collapse_user_flag) {
  collapse_user(collapse_bugzilla_user);
}
if(hide_viewvc) {
  collapse_viewvc();
}

gatherCIStats(document);

var e;
var be;
e = document.createElement('div');
e.setAttribute('class', 'bz_comment');
e.setAttribute('id', bz_comment_ci);
be = document.createElement('b');
be.appendChild(document.createTextNode('Bug Commit Summary:'));
e.appendChild(be);
var first_branch = true;
for(var branch_path in trunk_links_r2) {
  if(trunk_links_r2.hasOwnProperty(branch_path)) {
    var number_modified_files = 0;
    for(var i in trunk_links_r2[branch_path]) {
      if(trunk_links_r2[branch_path].hasOwnProperty(i)) {
        number_modified_files++;
      }
    }
    e.appendChild(document.createElement('br'));
    var a = document.createElement('a');
    a.setAttribute('href', '#');
    a.setAttribute('onClick', 'setVisible(\''+'ci_'+branch_path.replace('/', '_')+'\');return false;');
    //a.setAttribute('onClick', 'return false;');
    a.innerHTML = '*';
    e.appendChild(a);
    be = document.createElement('b');
    be.appendChild(document.createTextNode(' '+branch_path.replace(/\/$/, '')));
    e.appendChild(be);
    e.appendChild(document.createTextNode(' - ' + number_modified_files + ' modified file(s):'));
  
    var e_bak = e;
    e = document.createElement('span');
    if(first_branch) {
      e.setAttribute('style', 'display: inline');
      first_branch = false;
    } else {
      e.setAttribute('style', 'display: none');
    }
    e.setAttribute('id', 'ci_'+branch_path.replace('/', '_'));
    for(var i in trunk_links_r2[branch_path]) {
      if(trunk_links_r2[branch_path].hasOwnProperty(i)) {
        var r2_val = trunk_links_r2[branch_path][i];
        var r1_val;
        if(trunk_links_r1[branch_path]) {
            r1_val = trunk_links_r1[branch_path][i];
        }
        e.appendChild(document.createElement('br'));
        var input = document.createElement('input');
        input.setAttribute('type', 'radio');
        input.setAttribute('name', 'src_file');
        input.setAttribute('value', branch_path+i);
        input.setAttribute('onClick', 'setRevision(\''+(r2_val?r2_val:r1_val)+'\'); setFileName(\''+branch_path+i+'\');');
        e.appendChild(input);
  
        be = document.createElement('b');
  
        var ae = document.createElement('a');
        var url_args;
        var url;
        if(r1_val) {
          url_args = '?r1='+r1_val+'&r2='+r2_val;
        } else {
          url_args = '?view=markup&revision='+r2_val;
        }
  
        url = ci_code_link[branch_path][i] + url_args;
        ae.setAttribute('href', url);
        var s = document.createElement('b');
        var link_html;
        link_html = '<b>';
        link_html += i.split('/', 2)[0];
        link_html += '</b>/';
        link_html += i.substring(i.indexOf('/')+1);
        ae.innerHTML = link_html;
  
        e.appendChild(ae);
        if(ci_comments[branch_path+i]) {
          for(var m=0; m<ci_comments_ext.length; m++) {
            if(ci_comments_ext[m].is_ci && ci_comments_ext[m].rev == r2_val) {
              if(ci_comments_ext[m].file === branch_path+i) {
                e.appendChild(document.createTextNode(' '));
                var a = document.createElement('a');
                a.setAttribute('href', url+'#l'+ci_comments_ext[m].line);
                a.innerHTML = ci_comments_ext[m].line;
                e.appendChild(a);
                e.appendChild(document.createTextNode('('));
                e.appendChild(document.createTextNode(ci_comments_ext[m].num_node.getElementsByTagName('a')[0].innerHTML));
                e.appendChild(document.createTextNode(')'));
              }
            }
          }
        }
      }
    }
    e_bak.appendChild(e);
    e = e_bak;
  }
}
e.appendChild(document.createElement('br'));
var p;
if(release) {
  be = document.createElement('b');
  be.appendChild(document.createTextNode('Bug Merged into: '+release+'\n'));
  p = document.createElement('p');
  p.appendChild(be);
  e.appendChild(p);
}

var els = document.getElementsByTagName('div');
for(var i=0; i< els.length; i++) {
  var re = new RegExp('\\b' + 'bz_first_comment' + '\\b');
  if(els[i].className.match(re)) {
    els[i].parentNode.insertBefore(e, els[i]);
    break;
  }
}
//find updates and warn
getScriptUpdateVer(script_update_source);

var logged_as = '';
var header = document.getElementById('header');
if(header) {
  var links = header.getElementsByClassName('links');
  if (links[0]) {
    var links_children = links[0].children;
    var links_children_childNodes = links_children[links_children.length-1].childNodes;
    logged_as = links_children_childNodes[links_children_childNodes.length-1].textContent.replace(new RegExp('\\s*'), '');
  }
}

var assignee = '';
var as = document.getElementById("bz_assignee_edit_container");
if (as) {
  assignee = as.getElementsByClassName('email')[0].getAttribute('href').replace('mailto:', '');
}

var scriptElement = document.createElement('script');
scriptElement.type = 'text/javascript';
var cf_inspected_orig = document.getElementById('cf_inspected');

var bug_status_orig = document.getElementById('bug_status');
var resolution_orig = document.getElementById('resolution');

scriptElement.innerHTML = 'function ci_submit() {  ' +
'  var ln_re = /^\\d+$/;  ' +
'  var rv_re = /^\\d+$/;  ' +
'  var fn_re = /.*/;  ' +
'  var cm_e = document.getElementById("comment");  ' +
'  var ct_e = document.getElementById("ci_comment_type");  ' +
'  var ln_e = document.getElementById("line_number");  ' +
'  var fn_e = document.getElementById("file_name");  ' +
'  var rv_e = document.getElementById("rev");  ' +
'  var ln, fn, rv;  ' +
'  if(ln_e.value != "") {  ' +
'    if(!ln_e.value.match(ln_re)) {  ' +
'      alert("Line number must consist only from digits. Commit aborted.");  ' +
'      return false;  ' +
'    } else {  ' +
'      ln = " line:"+ln_e.value;  ' +
'    }  ' +
'  } else ln = "";  ' +
'  if(fn_e.value != "") {  ' +
'    if(!fn_e.value.match(fn_re)) {  ' +
'      alert("Wrong file name. Commit aborted.");  ' +
'      return false;  ' +
'    } else {  ' +
'      fn = " file:"+fn_e.value;  ' +
'    }  ' +
'  } else fn = "";  ' +
'  if(rv_e.value != "") {  ' +
'    if(!rv_e.value.match(rv_re)) {  ' +
'      alert("Wrong revision. Please report a bug. Commit aborted. To continue, please disable extension.");  ' +
'      return false;  ' +
'    } else {  ' +
'      rv = " rev:"+rv_e.value;  ' +
'    }  ' +
'  } else rv = "";  ' +
'  switch(ct_e.options[ct_e.selectedIndex].value) {  ' +
'  case "NORMAL_COMMENT":  ' +
'  if(ln) {  ' +
'    alert("Line number selected but no comment type. Commit aborted.");  ' +
'    return false;  ' +
'  }  ' +
'  break;  ' +
'  case "CI_STYLE":  ' +
'  cm_e.value = "--- CI comment severity:style"+fn+rv+ln+" ---\\n\\n"+cm_e.value;  ' +
'  break;  ' +
'  case "CI_MINOR":  ' +
'  cm_e.value = "--- CI comment severity:minor"+fn+rv+ln+" ---\\n\\n"+cm_e.value;  ' +
'  break;  ' +
'  case "CI_NORMAL":  ' +
'  cm_e.value = "--- CI comment severity:normal"+fn+rv+ln+" ---\\n\\n"+cm_e.value;  ' +
'  break;  ' +
'  case "CI_MAJOR":  ' +
'  cm_e.value = "--- CI comment severity:major"+fn+rv+ln+" ---\\n\\n"+cm_e.value;  ' +
'  break;  ' +
'  case "CI_ACCEPTED": if ("' + assignee + '" === "' + logged_as + '") { alert("Cannot give accept dispostion as author."); return false; } ' +
'  cm_e.value = "--- CI accepted ---\\n\\n"+cm_e.value;  ' +
'  break;  ' +
'  }  ' +
'  var cf_insepcted = document.getElementById("cf_inspected");' +
'  if ( "' + cf_inspected_orig.value + '" != cf_insepcted.value && cf_insepcted.value === "true" && "' + assignee + '" === "' + logged_as + '") {' +
'    alert("Code Inspected flag cannot be set to true by the author!");' +
'    return false;' +
'  }' +
'  var bug_status = document.getElementById("bug_status");' +
'  var resolution = document.getElementById("resolution");' +
'  if ((( "' + bug_status_orig.value + '" != bug_status.value && bug_status.value == "RESOLVED" && resolution.value == "FIXED") ' +
'      || (bug_status.value == "RESOLVED" && "' + resolution_orig.value + '" != resolution.value && resolution.value == "FIXED")) && "' + assignee + '" === "' + logged_as + '" && cf_insepcted.value != "true") {' +
'    alert("Cannot set RESOLVED/FIXED. Ask moderator to set Code Inspected flag to true after verifying all comments.");' +
'    return false;' +
'  }' +
'  if ( "' + bug_status_orig.value + '" != bug_status.value && bug_status.value == "REOPENED" && cf_insepcted.value === "true") { ' +
'    cf_insepcted.value = "false"; ' +
'  }' +
'  return true;  ' +
'}  ' +
'  ' +
'function setRevision(rev) {  ' +
'  var fn_e = document.getElementById("rev");  ' +
'  fn_e.value = rev;  ' +
'}  ' +
'  ' +
'function setFileName(file) {  ' +
'  var ln_e = document.getElementById("file_name");  ' +
'  ln_e.value = file;  ' +
'}';

if(!is_viewvc && !is_bug_list) {
  document.getElementsByTagName("head")[0].appendChild(scriptElement);

  if(document.getElementsByName('changeform')[0]) {
    document.getElementsByName('changeform')[0].setAttribute('onSubmit', "return ci_submit()");
  }

  p = document.createElement('p');
  //p.appendChild(document.createElement('br'));
  be = document.createElement('b');
  be.appendChild(document.createTextNode('Code Inspection '));
  if(!is_ci_accepted) {
    be.appendChild(document.createTextNode('status: NOT ACCEPTED'));
    p.appendChild(be);
  } else {
    be.appendChild(document.createTextNode('accepted by: '));
    p.appendChild(be);
    var num = 0;
    for (i in ci_accepted_users) {
      if(ci_accepted_users.hasOwnProperty(i)) {
        p.appendChild(document.createTextNode((num++>0?', ':'')+i));
      }
    }
  }
  p.appendChild(document.createElement('br'));
  e.appendChild(p);
  p = document.createElement('p');
  be = document.createElement('b');
  be.appendChild(document.createTextNode('Code Inspection comments: ' + ci_comments_num+'\n'));
  p.appendChild(be);
  e.appendChild(p);

  var to='';
  var to_sel='';
  var cc = document.getElementById("cc");
  if (cc) {
    for(var opt=0; opt<cc.options.length; opt++) {
      if (to !== '') {
        to += email_separator;
      }
      to += cc.options[opt].value;
      if(cc.options[opt].selected) {
        if (to_sel !== '') {
          to_sel += email_separator;
        }
        to_sel += cc.options[opt].value;
      }
    }
  }

  p = document.createElement('p');
  var ci_email = document.createElement('a');
  var title_re = new RegExp('(Bug \\d+) [^ ] (.*)');
  var title = document.title;
  var m = title.match(title_re);
  if(m) {
    title = m[1] + ' - ' + m[2];
  }
  var subject = ci_email_subject_prefix+title;
  //var ci_email_body = "You are invited to participate in a code inspection of:%0a"
    //+document.title+"%0a%0a"+document.URL+"%0a";
  ci_email_body = ci_email_body.replace('{title}', title);
  ci_email_body = ci_email_body.replace('{url}', document.URL);
	// + title+"%0a%0a"+document.URL+"%0a";
  if(!document.title.match(bug_processed)) {
    ci_email.setAttribute('href', 'mailto:'+to+'?subject='+subject+'&cc='+ci_cc_list+'&body='+ci_email_body);
    ci_email.setAttribute('title', 'All users from bug CC will be included on the To: list.');
  } else {
    ci_email.setAttribute('href', "#");
    ci_email.setAttribute('onMouseDown', "alert('You are on wrong page to send invitation. Go to the bug page and try again.');");
  }
  ci_email.innerHTML = 'Send invitation';
  p.appendChild(ci_email);
  e.appendChild(p);

  var opt_div = document.createElement('div');
  var tr = document.createElement('tr');
  var td = document.createElement('td');
  be = document.createElement('b');
  be.appendChild(document.createTextNode('CI comment'));
  tr.appendChild(be);
  tr.appendChild(document.createTextNode(':'));
  tr.appendChild(td);
  td = document.createElement('td');
  var select = document.createElement('select');
  select.setAttribute('name', 'ci_comment_type');
  select.setAttribute('id', 'ci_comment_type');
  var option = document.createElement('option');
  option.setAttribute('value', 'NORMAL_COMMENT');
  option.appendChild(document.createTextNode('---'));
  select.appendChild(option);
  option = document.createElement('option');
  option.setAttribute('value', 'CI_STYLE');
  option.appendChild(document.createTextNode('CI comment STYLE'));
  select.appendChild(option);
  option = document.createElement('option');
  option.setAttribute('value', 'CI_MINOR');
  option.appendChild(document.createTextNode('CI comment MINOR'));
  select.appendChild(option);
  option = document.createElement('option');
  option.setAttribute('value', 'CI_NORMAL');
  option.appendChild(document.createTextNode('CI comment NORMAL'));
  select.appendChild(option);
  option = document.createElement('option');
  option.setAttribute('value', 'CI_MAJOR');
  option.appendChild(document.createTextNode('CI comment MAJOR'));
  select.appendChild(option);
  option = document.createElement('option');
  option.setAttribute('value', 'CI_ACCEPTED');
  option.appendChild(document.createTextNode('CI accepted'));
  select.appendChild(option);
  td.appendChild(select);
  tr.appendChild(td);
  e.appendChild(tr);

  tr = document.createElement('tr');
  td = document.createElement('td');
  be = document.createElement('b');
  be.appendChild(document.createTextNode('File name'));
  tr.appendChild(be);
  tr.appendChild(document.createTextNode(':'));
  tr.appendChild(td);
  td = document.createElement('td');
  var input = document.createElement('input');
  input.setAttribute('type', 'text');
  input.setAttribute('name', 'file_name');
  input.setAttribute('id', 'file_name');
  input.setAttribute('disabled', 'true');
  td.appendChild(input);
  tr.appendChild(td);
  e.appendChild(tr);

  tr = document.createElement('tr');
  td = document.createElement('td');
  be = document.createElement('b');
  be.appendChild(document.createTextNode('Revision'));
  tr.appendChild(be);
  tr.appendChild(document.createTextNode(':'));
  tr.appendChild(td);
  td = document.createElement('td');
  input = document.createElement('input');
  input.setAttribute('type', 'text');
  input.setAttribute('name', 'rev');
  input.setAttribute('id', 'rev');
  input.setAttribute('disabled', 'true');
  td.appendChild(input);
  tr.appendChild(td);
  e.appendChild(tr);

  tr = document.createElement('tr');
  td = document.createElement('td');
  be = document.createElement('b');
  be.appendChild(document.createTextNode('Line number'));
  tr.appendChild(be);
  tr.appendChild(document.createTextNode(':'));
  tr.appendChild(td);
  td = document.createElement('td');
  input = document.createElement('input');
  input.setAttribute('type', 'text');
  input.setAttribute('name', 'line_number');
  input.setAttribute('id', 'line_number');
  td.appendChild(input);
  tr.appendChild(td);
  e.appendChild(tr);
}

// vim: et sw=2 sts=2:
