/*jshint  esnext:true*/
const DEBUG_IGNORED_EVENTS = true;
const PRINT_PAYLOAD_IF_IGNORED =false;
const DESC_MAX_LENGTH = 140;
const JIRA_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACRElEQVRYhbWXsUscQRTGf4iIyHHIISIWIsHisMgfkNIiBJFwiKQIkipVqpA/wEZEggSxEkmZwiKI5A84REKKkIMQrINYBQmHBDmEHJdNMW+42dk3d3O76wcDu2/e973vZvfN7EF+PAfaMjYL6AzFJFBRYh0gkdEBpryciuQVwjPgFugCu068CvQcAz1g2pnfEc6taOTGL6dIAjxw5nad+FsnvuhxrosYuPbElrz5Rc8Ucu9yfhcxsAncYZZ4fwTeO+HcUcILWgFqOXg1si9vFBrAXB7iEMySfYQZzGCeWxdoAq+Bh8BYjoJjwn0jWrYrqsOIbdIvUQLseTmPgHXgiYx1ibnYU3RuYpyfKMQ/mNWx+KzkfHHmZ4Tj55zGGNhQiAlw5OQ8VeYbzvxRQCNqUxoHLgMCa07eRyd+4sTXAtwrYCLGAJje1URugLrkVIHvMuyLVZccjfsitrhFMyD0k36bTtA/cOZkTuOckaOTFtA7IgEuSG9ONeBHILctWrnwGNO/mvA3zAk4LddaThfTpoXwKiBuVyL0yxPhloLtAUVCY7us4hb7IxQ/KLu4xWFE8cP7Kg6mld4PKH5BvoNrZBMfBphohKnFMAusyvU48ClgoA3M34eBUynwUu6ngK8BE1Gn3ihYccR79Jd5nuyXsx0rZRo498Q7mK8dMDudZuC8rOLLgQI7Ts5xIGe5DANbinCP9AfmEul/SnZslWHgTBFuKnna8a3lpRCzadSVWMiAj6GPIMbAX+/+H9BS8loyN4ibwX9j/jIXDkk+pgAAAABJRU5ErkJggg==';
function stripDesc(str) {
	if (!str)
		return '';
	return (str.length > DESC_MAX_LENGTH) ? str.slice(0, DESC_MAX_LENGTH - 3) + '...' : str;
}

function prepareAttachment({ issue, user }, text) {
	let issueType = issue.fields.issuetype;
	let res = {
		author_name: user ? user.displayName : ''
		, author_icon: user ? user.avatarUrls['24x24'] : ''
		, thumb_url: issueType.iconUrl
		, ts: issue.fields.created
	};
	if (text) {
		text = text.replace(/\{\{(user|issue)\.([^a-z_0-9]+)\}\}/g, (m, type, key) => (type === 'user' ? user : issue)[key]);
		res.text = text;
	}
	return res;
}
class Script {
	process_incoming_request({ request }) {
		const data = request.content;
		try {
			if (!data.issue || (data.user && data.user.name === 'gitlab')) {
				//we dont have enough info
				if (DEBUG_IGNORED_EVENTS) {
					let ignoreMsg = "Not enough info on issue. Event ignored.";
					if (data.webhookEvent) {
						ignoreMsg = `Jira event ${data.webhookEvent}. ${ignoreMsg}`;
					}
					console.log(ignoreMsg);
					if(PRINT_PAYLOAD_IF_IGNORED) {
						console.log(JSON.stringify(data,null,2));
					}
				}
				return;
			}
			let issue = data.issue;
			let baseJiraUrl = issue.self.replace(/\/rest\/.*$/, '');
			let assignee = issue.fields.assignee || {}
			let user = data.user || {};
			let assignedTo = (assignee.name !== user.name) ? `, assigned to ${issue.fields.assignee.displayName}` : '';
			let issueSummary = `[${issue.key}](${baseJiraUrl}/browse/${issue.key}) ${issue.fields.summary} _(${issue.fields.priority.name.replace(/^\s*\d*\.\s*/, '')}${assignedTo})_`;
			let message = {
				icon_url: (issue.fields.project && issue.fields.project.avatarUrls && issue.fields.project.avatarUrls['48x48']) || JIRA_LOGO
				, attachments: []
			};

			if (data.webhookEvent === 'jira:issue_created') {
				message.attachments.push(prepareAttachment(data, `*Created* ${issueSummary}:\n${stripDesc(issue.fields.description)}`));
			} else if (data.webhookEvent === 'jira:issue_deleted') {
				message.attachments.push(prepareAttachment(data, `*Deleted* ${issueSummary}`));
			} else if (data.webhookEvent === 'jira:issue_updated') {
				if (data.changelog && data.changelog.items) { // field update
					let logs = [];
					data.changelog.items.forEach((change) => {
						if (change.field === 'description') {
							logs.push(`Changed *description* to:\n\`\`\`\n${stripDesc(change.toString)}\n\`\`\``);
						} else {
							logs.push(`*${change.field}* changed from ${change.fromString} to *${change.toString}*`);
						}
					});
					logs.length && message.attachments.push(prepareAttachment(data, `*Updated* ${issueSummary}:\n  - ${logs.join('\n  - ')}`));
				} else {
					//we dont have change logs
					if (DEBUG_IGNORED_EVENTS) {
						let ignoreMsg = "No change log items. Event ignored.";
						if (data.webhookEvent) {
							ignoreMsg = `Jira event ${data.webhookEvent}. ${ignoreMsg}`;
						}
						console.log(ignoreMsg);
						if(PRINT_PAYLOAD_IF_IGNORED) {
							console.log(JSON.stringify(data,null,2));
						}
					}
					return;
				}
			} else if (data.webhookEvent === 'comment_created') {
				let comment = data.comment;
				let commentAuthoring = comment.author && comment.author.displayName ? ` by ${comment.author.displayName}` : '';
				data.user = comment.author;
				message.attachments.push(prepareAttachment(data, `Comment created for ${issueSummary}:\n\`\`\`\n${stripDesc(comment.body)}\n\`\`\`\n${commentAuthoring}`));
			} else if (data.webhookEvent === 'comment_updated') {
				let comment = data.comment;
				let commentAuthoring = comment.author && comment.author.displayName ? ` by ${comment.author.displayName}` : '';
				data.user = comment.author;
				message.attachments.push(prepareAttachment(data, `Comment updated for ${issueSummary}:\n\`\`\`\n${stripDesc(comment.body)}\n\`\`\`\n${commentAuthoring}`));
			} else if (data.webhookEvent === 'comment_deleted') {
				let comment = data.comment;
				let commentAuthoring = comment.author && comment.author.displayName ? ` by ${comment.author.displayName}` : '';
				data.user = comment.author;
				message.attachments.push(prepareAttachment(data, `Comment deleted for ${issueSummary}:\n\`\`\`\n${stripDesc(comment.body)}\n\`\`\`\n${commentAuthoring}`));
			} else {
				//we dont have enough info
				if (DEBUG_IGNORED_EVENTS) {
					let ignoreMsg = "No handler for the event. Event ignored.";
					if (data.webhookEvent) {
						ignoreMsg = `Jira event ${data.webhookEvent}. ${ignoreMsg}`;
					}
					console.log(ignoreMsg);
					if(PRINT_PAYLOAD_IF_IGNORED) {
						console.log(JSON.stringify(data,null,2));
					}
				}
				return;
			}

			if (message.text || message.attachments.length) {
				return { content: message };
			}
		} catch (e) {
			console.log('jiraevent error', e);
			return {
				error: {
					success: false,
					message: `${e.message || e} ${JSON.stringify(data)}`
				}
			};
		}
	}
}
