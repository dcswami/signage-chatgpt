To pull and test the newly pushed code from GitHub, follow these step-by-step Git commands in your terminal. [1] 
## 1. Open and Navigate
Open your terminal.
Navigate to your project folder.

cd path/to/codex/authentication-rbac

## 2. Fetch Latest Changes
Download all new history and branches from GitHub. [2] 

git fetch origin

## 3. List All Branches
View both local and remote branches to find the new code.

git branch -a

Note: Remote branches will appear in red, usually prefixed with remotes/origin/. [3, 4] 
## 4. Select and Switch Branch
Switch to the specific branch containing the new code. [5] 

git checkout <branch-name>

Example: If the branch is named feature-auth, type git checkout feature-auth.
## 5. Pull the Latest Code [6] 
Ensure your local branch matches the exact, updated code on GitHub.

git pull origin <branch-name>



## 6. Compose Docker

docker compose -f docker-compose.test.yml -p signage-test build app
docker compose -f docker-compose.test.yml -p signage-test up -d --force-recreate
docker compose -f docker-compose.test.yml -p signage-test ps
------------------------------
To help you with the next steps, could you tell me:

* What is the exact name of the new branch you want to work on?
* Do you need help installing dependencies or running the project after switching?
* Are you planning to merge this code into your main branch?


[1] [https://faizahsalami1.medium.com](https://faizahsalami1.medium.com/a-beginners-guide-to-pushing-codes-from-vs-code-to-github-using-git-part-1-fbea7bb482f)
[2] [https://www.geeksforgeeks.org](https://www.geeksforgeeks.org/blogs/ultimate-guide-git-github/)
[3] [https://graphite.com](https://graphite.com/guides/git-branch-not-showing-all-branches)
[4] [https://www.freecodecamp.org](https://www.freecodecamp.org/news/git-pull-explained/)
[5] [https://docs.gitcode.com](https://docs.gitcode.com/en/docs/start/quick/)
[6] [https://codestax.medium.com](https://codestax.medium.com/aws-codecommit-pull-request-creation-and-approval-b7b6766d8da0)
